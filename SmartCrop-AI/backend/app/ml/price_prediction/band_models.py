"""Model classes saved inside trained_models/price_prediction/crop_band_models.joblib (importable so the artifact can be unpickled at serving time).

``MovingAverageRidge`` is a regularised linear model on moving-average gaps and short momentum only. Because it is linear, its explanation is
exact: each input's contribution is coef * standardised value, and the baseline is the intercept (the prediction for an average input)."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

MA_FEATURES = ["roll_mean_7_gap", "roll_mean_14_gap", "roll_mean_30_gap", "lag_30_change", "momentum_7_30", "state_price_gap"]


class MovingAverageRidge:
    def __init__(self, features: list[str] | None = None, alpha: float = 300.0) -> None:
        self.features = list(features or MA_FEATURES)
        self.alpha = alpha

    def fit(self, X: pd.DataFrame, y) -> "MovingAverageRidge":
        Xc = X[self.features].fillna(0)
        self.scaler = StandardScaler().fit(Xc)
        self.ridge = Ridge(alpha=self.alpha).fit(self.scaler.transform(Xc), y)
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return self.ridge.predict(self.scaler.transform(X[self.features].fillna(0)))

    def contributions(self, X: pd.DataFrame) -> tuple[dict[str, float], float]:
        """({feature: contribution to the log change}, baseline) for the first row of X; contributions + baseline = predict(X)[0]."""
        z = self.scaler.transform(X[self.features].fillna(0))[0]
        return {f: float(c * v) for f, c, v in zip(self.features, self.ridge.coef_, z)}, float(self.ridge.intercept_)
