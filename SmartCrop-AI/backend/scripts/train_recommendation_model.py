"""Stage 6b: train and evaluate the crop recommendation (agronomic suitability) classifier.

Run from backend/:  python -m scripts.generate_crop_dataset   (once, creates the original dataset)
                    python -m scripts.extend_crop_dataset     (adds dry/cool-season synthetic rows)
                    python -m scripts.train_recommendation_model

Protocol: the stratified 80/20 hold-out test split is made from the ORIGINAL rows only (source ==
"original"); synthetic rows are only ever used for training. Model comparison uses 5-fold
stratified CV on the training part only; the hold-out set is evaluated once. The same test set
also scores a "before" model trained on the original training rows alone, so the effect of the
synthetic rows is measured on identical data. The deployed model is
XGBoost (the project's chosen model family; the comparison is reported so the choice can be
checked) refitted on all rows.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import joblib
import matplotlib
import numpy as np
import pandas as pd
import shap
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, classification_report, confusion_matrix,
                             precision_recall_fscore_support)
from sklearn.model_selection import StratifiedKFold, cross_validate, train_test_split
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import LabelEncoder, OneHotEncoder, StandardScaler
from xgboost import XGBClassifier

from app.ml.common import paths
from app.ml.common.reference import cities
from app.ml.crop_recommendation.features import (FEATURES, NUMERIC_INPUTS, SOIL_TYPES, build_features,
                                                   collapse_shap)

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

SEED = 42
DEPLOYED = "xgboost"


def one_hot_soil() -> ColumnTransformer:
    """soil_type -> one-hot columns (unseen values are all-zero); every other column passes through.
    Part of the sklearn Pipeline, so training and serving encode soil type identically."""
    return ColumnTransformer(
        [("soil", OneHotEncoder(categories=[SOIL_TYPES], handle_unknown="ignore", sparse_output=False),
          ["soil_type"])],
        remainder="passthrough", verbose_feature_names_out=False).set_output(transform="pandas")


def make_models() -> dict:
    numeric = [f for f in FEATURES if f not in ("city_code", "soil_type")]
    return {
        "logistic_regression_baseline": make_pipeline(
            ColumnTransformer([("num", StandardScaler(), numeric),
                               ("cat", OneHotEncoder(handle_unknown="ignore"),
                                ["city_code", "soil_type"])]),
            LogisticRegression(max_iter=3000)),
        "random_forest": Pipeline([("prep", one_hot_soil()), ("model", RandomForestClassifier(
            n_estimators=300, min_samples_leaf=2, n_jobs=-1, random_state=SEED))]),
        "xgboost": Pipeline([("prep", one_hot_soil()), ("model", XGBClassifier(
            n_estimators=400, max_depth=4, learning_rate=0.08, subsample=0.9, colsample_bytree=0.9,
            min_child_weight=2, reg_lambda=1.0, tree_method="hist", random_state=SEED, n_jobs=-1))]),
    }


def main() -> None:
    out = paths.REC_MODEL_DIR
    out.mkdir(parents=True, exist_ok=True)
    df = pd.read_csv(paths.REC_EXTENDED_DATASET_PATH)
    city_list = list(cities())
    unknown = set(df["city"]) - set(city_list)
    assert not unknown, f"cities missing from reference table: {unknown}"

    quality = {"rows": len(df), "columns": list(df.columns), "synthetic": True,
               "source_counts": df["source"].value_counts().to_dict(),
               "missing_values": df.isna().sum().astype(int).to_dict(),
               "duplicate_rows": int(df.duplicated().sum()),
               "class_counts": df["label"].value_counts().to_dict(),
               "feature_summary": df[NUMERIC_INPUTS].describe().round(2).to_dict()}

    le = LabelEncoder()
    y = le.fit_transform(df["label"])
    X = build_features(df, city_list)
    is_orig = (df["source"] == "original").to_numpy()
    orig_idx = np.flatnonzero(is_orig)
    tr_orig, te_idx = train_test_split(orig_idx, test_size=0.2, stratify=y[orig_idx],
                                       random_state=SEED)
    tr_idx = np.concatenate([tr_orig, np.flatnonzero(~is_orig)])    # + synthetic rows
    X_tr, X_te, y_tr, y_te = X.iloc[tr_idx], X.iloc[te_idx], y[tr_idx], y[te_idx]
    print(f"train {len(tr_idx)} ({len(tr_orig)} original + {int((~is_orig).sum())} synthetic), "
          f"test {len(te_idx)} (original only)")

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    scoring = ["accuracy", "precision_macro", "recall_macro", "f1_macro"]
    comparison = {}
    for name, model in make_models().items():
        r = cross_validate(model, X_tr, y_tr, cv=cv, scoring=scoring, n_jobs=1)
        comparison[name] = {m: {"mean": float(r[f"test_{m}"].mean()),
                                "std": float(r[f"test_{m}"].std())} for m in scoring}
        print(f"{name:<30} CV macro-F1 {comparison[name]['f1_macro']['mean']:.4f} "
              f"± {comparison[name]['f1_macro']['std']:.4f}")

    def score(m, Xa, ya, Xb, yb):
        pr = m.fit(Xa, ya).predict(Xb)
        p_, r_, f_, _ = precision_recall_fscore_support(yb, pr, average="macro")
        return pr, {"accuracy": float(accuracy_score(yb, pr)), "precision_macro": float(p_),
                    "recall_macro": float(r_), "f1_macro": float(f_), "n_test": int(len(yb))}

    # before: original training rows only; after: original + synthetic. Same original-only test set.
    before_pred, before = score(make_models()[DEPLOYED], X.iloc[tr_orig], y[tr_orig], X_te, y_te)
    model = make_models()[DEPLOYED]
    pred, test_metrics = score(model, X_tr, y_tr, X_te, y_te)
    print("before (original rows only):", json.dumps(before))
    print("after  (+ synthetic rows):  ", json.dumps(test_metrics))
    report = classification_report(y_te, pred, target_names=le.classes_, output_dict=True)
    cm = confusion_matrix(y_te, pred)
    pd.DataFrame(cm, index=le.classes_, columns=le.classes_).to_csv(out / "confusion_matrix.csv")
    cm_before = confusion_matrix(y_te, before_pred)
    pd.DataFrame(cm_before, index=le.classes_, columns=le.classes_).to_csv(out / "confusion_matrix_before.csv")
    (out / "before_after.json").write_text(json.dumps(
        {"test_set": "original rows only", "before": before, "after": test_metrics}, indent=2), encoding="utf-8")
    print("confusion matrix (after), rows = actual:")
    print(pd.DataFrame(cm, index=le.classes_, columns=le.classes_).to_string())
    pd.DataFrame(report).T.round(4).to_csv(out / "classification_report.csv")

    fig, ax = plt.subplots(figsize=(7, 6))
    ax.imshow(cm, cmap="Greens")
    ax.set_xticks(range(len(le.classes_)), le.classes_, rotation=45, ha="right")
    ax.set_yticks(range(len(le.classes_)), le.classes_)
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            if cm[i, j]:
                ax.text(j, i, cm[i, j], ha="center", va="center", fontsize=9)
    ax.set_xlabel("Predicted"), ax.set_ylabel("Actual")
    ax.set_title(f"Crop recommendation — confusion matrix (test set, {DEPLOYED})")
    fig.tight_layout()
    fig.savefig(out / "confusion_matrix.png", dpi=120)
    plt.close(fig)

    # Deployed model: same configuration refitted on all rows.
    final = make_models()[DEPLOYED].fit(X, y)
    joblib.dump(final, out / "crop_model.joblib", compress=3)
    joblib.dump(le, out / "label_encoder.joblib")

    # Per-crop ranges observed in the dataset — used to phrase explanations
    # ("your rainfall is within the range seen for onion"), never as agronomic advice.
    ranges = {}
    for crop, g in df.groupby("label"):
        ranges[crop] = {f: {"p05": float(g[f].quantile(.05)), "median": float(g[f].median()),
                            "p95": float(g[f].quantile(.95))} for f in NUMERIC_INPUTS}
        ranges[crop]["_cities"] = (g["city"].value_counts(normalize=True).round(3).to_dict())

    Xs = final[:-1].transform(X.sample(600, random_state=SEED))
    sv = np.asarray(shap.TreeExplainer(final.named_steps["model"]).shap_values(Xs))
    if sv.ndim == 3 and sv.shape[0] == len(le.classes_):   # -> (samples, columns, classes)
        sv = np.transpose(sv, (1, 2, 0))
    sv = collapse_shap(sv, list(Xs.columns))                # one-hot soil columns -> soil_type
    global_imp = dict(zip(FEATURES, np.abs(sv).mean(axis=(0, 2)).round(5).tolist()))

    # Min/max of every numeric input in the training data: the single source for the form hints,
    # slider limits and the out-of-range warning (read by the API, never hard-coded).
    (out / "feature_ranges.json").write_text(json.dumps(
        {"numeric": {f: {"min": float(df[f].min()), "max": float(df[f].max())} for f in NUMERIC_INPUTS},
         "soil_types": SOIL_TYPES, "dataset": paths.REC_EXTENDED_DATASET_PATH.name}, indent=2),
        encoding="utf-8")

    meta = {"model_type": "crop_recommendation", "selected_model": DEPLOYED,
            "version": datetime.now(timezone.utc).strftime("%Y%m%d%H%M"),
            "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "dataset": paths.REC_EXTENDED_DATASET_PATH.name, "synthetic_dataset": True,
            "features": FEATURES, "soil_types": SOIL_TYPES, "cities": city_list, "classes": le.classes_.tolist(),
            "split": "stratified 80/20 hold-out of the original rows (synthetic rows train only), "
                     "5-fold stratified CV on the training part",
            "shap_output": "log-odds (margin) per class",
            "cv_comparison": comparison, "test_metrics": test_metrics,
            "test_metrics_before_extension": before,
            "test_set": "original rows only (20 % stratified); synthetic rows are training-only",
            "data_quality": quality, "feature_ranges_by_crop": ranges,
            "global_shap_importance": global_imp}
    (out / "metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(test_metrics, indent=2))
    print("global SHAP:", global_imp)


if __name__ == "__main__":
    main()
