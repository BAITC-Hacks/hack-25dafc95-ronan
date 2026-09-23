import unittest

from ml_core.service import parse_rank


class ParseRankTests(unittest.TestCase):
    def test_brand_does_not_discard_type_or_current(self):
        candidates = [
            {"id": 1, "name": "АВ DRX250 3ф 160А 18ka Legrand", "article": "100000001_"},
            {"id": 2, "name": "АВ DRX125 3ф 80А 10ka Legrand", "article": "100000002_"},
            {"id": 3, "name": "Реле 5 А Legrand", "article": "100000003_"},
        ]
        for message in ("Нужен автомат Legrand на 160 А", "автомат 160А 18kA"):
            with self.subTest(message=message):
                result = parse_rank({"message": message, "candidates": candidates})
                self.assertEqual(result["query"], message)
                self.assertEqual(result["ranked_ids"], [1])
        result = parse_rank({"message": "Нужен автомат на 16 А", "candidates": candidates})
        self.assertEqual(result["ranked_ids"], [])

    def test_exact_articles_preserve_zeroes_and_underscores(self):
        candidates = [
            {"id": 515291, "name": "027228 АВ DRX250 160А", "article": "200300285_"},
            {"id": 900000001, "name": "Демо автомат 16 А", "article": "DEMO_001"},
        ]
        for article, expected in (("027228", 515291), ("200300285_", 515291), ("DEMO_001", 900000001)):
            with self.subTest(article=article):
                result = parse_rank({"message": f"Найди {article}", "candidates": candidates})
                self.assertEqual(result["query"], article)
                self.assertEqual(result["ranked_ids"], [expected])

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
