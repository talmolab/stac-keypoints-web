"""Suggest diverse frames for labeling using k-means clustering."""
from __future__ import annotations
import numpy as np
from scipy.cluster.vq import kmeans2


def suggest_frames(
    positions_flat: list[float],
    num_frames: int,
    num_keypoints: int,
    n_suggestions: int = 8,
) -> list[int]:
    """Select diverse frames via k-means on flattened pose vectors."""
    positions = np.array(positions_flat).reshape(num_frames, num_keypoints * 3)
    k = min(n_suggestions, num_frames)
    centroids, labels = kmeans2(positions, k, minit="++")
    selected = []
    for c in range(k):
        cluster_mask = labels == c
        cluster_indices = np.where(cluster_mask)[0]
        cluster_points = positions[cluster_mask]
        dists = np.linalg.norm(cluster_points - centroids[c], axis=1)
        best_in_cluster = cluster_indices[np.argmin(dists)]
        selected.append(int(best_in_cluster))
    return sorted(selected)
