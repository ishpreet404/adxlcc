"""
Cyber Chaukidaar - Tiny pure-Python Random Forest (CART, Gini).

No numpy / sklearn dependency so it trains on a Raspberry Pi or Windows box
with a bare Python install.  Model size is deliberately tiny (default 8 trees,
depth <= 6) so the exported forest fits in a few KB of ESP32 flash.
"""

import math
import random


class Node:
    __slots__ = ("feature", "threshold", "left", "right", "probs")

    def __init__(self):
        self.feature = -1
        self.threshold = 0.0
        self.left = None
        self.right = None
        self.probs = None

    @property
    def is_leaf(self):
        return self.probs is not None


def _gini(counts, total):
    if total == 0:
        return 0.0
    return 1.0 - sum((c / total) ** 2 for c in counts)


def _leaf(ys, n_classes):
    counts = [0] * n_classes
    for y in ys:
        counts[y] += 1
    tot = len(ys) or 1
    node = Node()
    node.probs = [c / tot for c in counts]
    return node


def _best_split(X, y, idx, features, n_classes, min_leaf):
    best = (None, None, 1e9)
    parent_total = len(idx)
    for f in features:
        vals = sorted(set(X[i][f] for i in idx))
        if len(vals) < 2:
            continue
        # candidate thresholds: midpoints of up to 24 quantiles (fast & robust)
        if len(vals) > 24:
            step = len(vals) / 24.0
            cand = [vals[int(k * step)] for k in range(1, 24)]
            cand = sorted(set((a + b) / 2 for a, b in zip(cand[:-1], cand[1:])))
        else:
            cand = [(a + b) / 2 for a, b in zip(vals[:-1], vals[1:])]
        for thr in cand:
            lc = [0] * n_classes
            rc = [0] * n_classes
            ln = 0
            for i in idx:
                if X[i][f] <= thr:
                    lc[y[i]] += 1
                    ln += 1
                else:
                    rc[y[i]] += 1
            rn = parent_total - ln
            if ln < min_leaf or rn < min_leaf:
                continue
            g = (ln * _gini(lc, ln) + rn * _gini(rc, rn)) / parent_total
            if g < best[2]:
                best = (f, thr, g)
    return best


def _build(X, y, idx, depth, cfg, n_classes, rng):
    ys = [y[i] for i in idx]
    if depth >= cfg["max_depth"] or len(idx) < 2 * cfg["min_leaf"] or len(set(ys)) == 1:
        return _leaf(ys, n_classes)

    n_feat = len(X[0])
    k = max(1, int(round(math.sqrt(n_feat)))) if cfg["max_features"] == "sqrt" else n_feat
    features = rng.sample(range(n_feat), k)
    f, thr, g = _best_split(X, y, idx, features, n_classes, cfg["min_leaf"])
    if f is None:
        # try all features before giving up
        f, thr, g = _best_split(X, y, idx, list(range(n_feat)), n_classes, cfg["min_leaf"])
        if f is None:
            return _leaf(ys, n_classes)

    node = Node()
    node.feature = f
    node.threshold = thr
    left = [i for i in idx if X[i][f] <= thr]
    right = [i for i in idx if X[i][f] > thr]
    node.left = _build(X, y, left, depth + 1, cfg, n_classes, rng)
    node.right = _build(X, y, right, depth + 1, cfg, n_classes, rng)
    return node


class RandomForest:
    def __init__(self, n_trees=8, max_depth=6, min_leaf=4, max_features="sqrt", seed=42):
        self.cfg = {"max_depth": max_depth, "min_leaf": min_leaf, "max_features": max_features}
        self.n_trees = n_trees
        self.seed = seed
        self.trees = []
        self.n_classes = 0

    def fit(self, X, y):
        rng = random.Random(self.seed)
        self.n_classes = max(y) + 1
        n = len(X)
        self.trees = []
        for t in range(self.n_trees):
            idx = [rng.randrange(n) for _ in range(n)]  # bootstrap
            self.trees.append(_build(X, y, idx, 0, self.cfg, self.n_classes, rng))
        return self

    @staticmethod
    def _predict_tree(node, x):
        while not node.is_leaf:
            node = node.left if x[node.feature] <= node.threshold else node.right
        return node.probs

    def predict_proba(self, x):
        acc = [0.0] * self.n_classes
        for tree in self.trees:
            p = self._predict_tree(tree, x)
            for c in range(self.n_classes):
                acc[c] += p[c]
        return [v / len(self.trees) for v in acc]

    def predict(self, x):
        p = self.predict_proba(x)
        return max(range(len(p)), key=lambda c: p[c])

    # ---- serialisation -----------------------------------------------------
    def to_dict(self, feature_names, class_names):
        def enc(node):
            if node.is_leaf:
                return {"p": [round(v, 4) for v in node.probs]}
            return {
                "f": node.feature,
                "t": round(node.threshold, 6),
                "l": enc(node.left),
                "r": enc(node.right),
            }

        return {
            "type": "random_forest",
            "features": list(feature_names),
            "classes": list(class_names),
            "trees": [enc(t) for t in self.trees],
        }

    def node_count(self):
        def cnt(node):
            return 1 if node.is_leaf else 1 + cnt(node.left) + cnt(node.right)

        return sum(cnt(t) for t in self.trees)


# ---------------------------------------------------------------------------
# Logistic regression (for the fusion model) - also pure Python
# ---------------------------------------------------------------------------
class LogisticRegression:
    def __init__(self, lr=0.1, epochs=400, l2=1e-3, seed=1):
        self.lr = lr
        self.epochs = epochs
        self.l2 = l2
        self.seed = seed
        self.w = []
        self.b = 0.0
        self.mean = []
        self.std = []

    def _norm(self, x):
        return [(v - m) / s for v, m, s in zip(x, self.mean, self.std)]

    def fit(self, X, y):
        n = len(X)
        d = len(X[0])
        self.mean = [sum(r[j] for r in X) / n for j in range(d)]
        self.std = [
            max(1e-6, math.sqrt(sum((r[j] - self.mean[j]) ** 2 for r in X) / n)) for j in range(d)
        ]
        Xn = [self._norm(r) for r in X]
        rng = random.Random(self.seed)
        self.w = [rng.uniform(-0.01, 0.01) for _ in range(d)]
        self.b = 0.0
        order = list(range(n))
        for _ in range(self.epochs):
            rng.shuffle(order)
            for i in order:
                z = self.b + sum(w * v for w, v in zip(self.w, Xn[i]))
                p = 1.0 / (1.0 + math.exp(-max(-30, min(30, z))))
                g = p - y[i]
                for j in range(d):
                    self.w[j] -= self.lr * (g * Xn[i][j] + self.l2 * self.w[j])
                self.b -= self.lr * g
        return self

    def predict_proba(self, x):
        z = self.b + sum(w * v for w, v in zip(self.w, self._norm(x)))
        return 1.0 / (1.0 + math.exp(-max(-30, min(30, z))))

    def to_dict(self, feature_names):
        return {
            "type": "logistic_regression",
            "features": list(feature_names),
            "mean": [round(v, 6) for v in self.mean],
            "std": [round(v, 6) for v in self.std],
            "weights": [round(v, 6) for v in self.w],
            "bias": round(self.b, 6),
        }
