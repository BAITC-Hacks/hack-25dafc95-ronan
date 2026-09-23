import unittest

from ml_core.service import parse_rank


class ParseRankTests(unittest.TestCase):
    def test_ranks_only_supplied_candidates_and_preserves_article(self):
        result = parse_rank({"message": "Есть 027228 в Астане?", "candidates": [
            {"id": 515291, "name": "027228 АВ DRX250", "article": "200300285_"},
            {"id": 515288, "name": "027230 АВ DRX250", "article": "200300282_"},
        ]})
        self.assertEqual(result["query"], "027228")
        self.assertEqual(result["ranked_ids"][0], 515291)
        self.assertTrue(set(result["ranked_ids"]) <= {515291, 515288})

    def test_rejects_duplicate_or_invalid_ids(self):
        with self.assertRaises(ValueError):
            parse_rank({"message": "027228", "candidates": [
                {"id": 1, "name": "a", "article": "x"},
                {"id": 1, "name": "b", "article": "y"},
            ]})
