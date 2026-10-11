"""Stage 6b: train and evaluate the crop recommendation (agronomic suitability) classifier.

Run from backend/:  python -m scripts.generate_crop_dataset   (once, creates the dataset)
                    python -m scripts.train_recommendation_model

Protocol: stratified 80/20 hold-out test split. Model comparison uses 5-fold stratified
CV on the training part only; the hold-out set is evaluated once. The deployed model is
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
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import LabelEncoder, OneHotEncoder, StandardScaler
from xgboost import XGBClassifier

from app.ml.common import paths
from app.ml.common.reference import cities
from app.ml.crop_recommendation.features import FEATURES, NUMERIC_INPUTS, build_features

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

SEED = 42
DEPLOYED = "xgboost"


def make_models() -> dict:
    numeric = [f for f in FEATURES if f != "city_code"]
    return {
        "logistic_regression_baseline": make_pipeline(
            ColumnTransformer([("num", StandardScaler(), numeric),
                               ("city", OneHotEncoder(handle_unknown="ignore"), ["city_code"])]),
            LogisticRegression(max_iter=3000)),
        "random_forest": RandomForestClassifier(n_estimators=300, min_samples_leaf=2,
                                                n_jobs=-1, random_state=SEED),
        "xgboost": XGBClassifier(n_estimators=400, max_depth=4, learning_rate=0.08,
                                 subsample=0.9, colsample_bytree=0.9, min_child_weight=2,
                                 reg_lambda=1.0, tree_method="hist", random_state=SEED,
                                 n_jobs=-1),
    }


def main() -> None:
    out = paths.REC_MODEL_DIR
    out.mkdir(parents=True, exist_ok=True)
    df = pd.read_csv(paths.REC_DATASET_PATH)
    city_list = list(cities())
    unknown = set(df["city"]) - set(city_list)
    assert not unknown, f"cities missing from reference table: {unknown}"

    quality = {"rows": len(df), "columns": list(df.columns), "synthetic": True,
               "missing_values": df.isna().sum().astype(int).to_dict(),
               "duplicate_rows": int(df.duplicated().sum()),
               "class_counts": df["label"].value_counts().to_dict(),
               "feature_summary": df[NUMERIC_INPUTS].describe().round(2).to_dict()}

    le = LabelEncoder()
    y = le.fit_transform(df["label"])
    X = build_features(df, city_list)
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, stratify=y,
                                              random_state=SEED)

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    scoring = ["accuracy", "precision_macro", "recall_macro", "f1_macro"]
    comparison = {}
    for name, model in make_models().items():
        r = cross_validate(model, X_tr, y_tr, cv=cv, scoring=scoring, n_jobs=1)
        comparison[name] = {m: {"mean": float(r[f"test_{m}"].mean()),
                                "std": float(r[f"test_{m}"].std())} for m in scoring}
        print(f"{name:<30} CV macro-F1 {comparison[name]['f1_macro']['mean']:.4f} "
              f"± {comparison[name]['f1_macro']['std']:.4f}")

    model = make_models()[DEPLOYED].fit(X_tr, y_tr)
    pred = model.predict(X_te)
    p, r, f, _ = precision_recall_fscore_support(y_te, pred, average="macro")
    test_metrics = {"accuracy": float(accuracy_score(y_te, pred)), "precision_macro": float(p),
                    "recall_macro": float(r), "f1_macro": float(f), "n_test": int(len(y_te))}
    report = classification_report(y_te, pred, target_names=le.classes_, output_dict=True)
    cm = confusion_matrix(y_te, pred)
    pd.DataFrame(cm, index=le.classes_, columns=le.classes_).to_csv(out / "confusion_matrix.csv")
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

    sv = np.asarray(shap.TreeExplainer(final).shap_values(X.sample(600, random_state=SEED)))
    if sv.ndim == 3 and sv.shape[0] == len(le.classes_):   # -> (samples, features, classes)
        sv = np.transpose(sv, (1, 2, 0))
    global_imp = dict(zip(FEATURES, np.abs(sv).mean(axis=(0, 2)).round(5).tolist()))

    meta = {"model_type": "crop_recommendation", "selected_model": DEPLOYED,
            "version": datetime.now(timezone.utc).strftime("%Y%m%d%H%M"),
            "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "dataset": paths.REC_DATASET_PATH.name, "synthetic_dataset": True,
            "features": FEATURES, "cities": city_list, "classes": le.classes_.tolist(),
            "split": "stratified 80/20 hold-out, 5-fold stratified CV on training part",
            "shap_output": "log-odds (margin) per class",
            "cv_comparison": comparison, "test_metrics": test_metrics,
            "data_quality": quality, "feature_ranges_by_crop": ranges,
            "global_shap_importance": global_imp}
    (out / "metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(test_metrics, indent=2))
    print("global SHAP:", global_imp)


if __name__ == "__main__":
    main()
