"""문자 2~3그램 TF-IDF를 이용한 유사 공개 문항 검색"""
from collections import Counter
from math import log, sqrt
import json
import sys
import unicodedata


def grams(question):
    normalized = unicodedata.normalize("NFKC", question).casefold()
    text = "".join(ch for ch in normalized if ch.isalnum())
    if len(text) < 2:
        return Counter([text]) if text else Counter()
    return Counter(text[i:i + n] for n in (2, 3) for i in range(len(text) - n + 1))


def rank_questions(query, questions):
    counts = grams(query)
    if not counts or not questions:
        return []
    # 문항별 글자 조합을 세고 조합이 등장한 문서 수 집계
    documents = [grams(text) for text in questions]
    frequency = Counter()
    for document in documents:
        frequency.update(document.keys())

    def weight(term, count):
        return (1 + log(count)) * (1 + log((1 + len(documents)) / (1 + frequency[term])))

    # TF-IDF 벡터의 내적을 두 벡터의 크기로 나눠 코사인 유사도 계산
    query_vector = {term: weight(term, count) for term, count in counts.items()}
    query_norm = sqrt(sum(value ** 2 for value in query_vector.values()))
    matches = []
    for question, document in zip(questions, documents):
        common = query_vector.keys() & document.keys()
        if not common:
            continue
        dot = sum(query_vector[t] * weight(t, document[t]) for t in common)
        norm = sqrt(sum(weight(t, n) ** 2 for t, n in document.items()))
        score = min(1.0, dot / (query_norm * norm))
        if score >= 0.18:
            matches.append({"question": question, "score": round(score, 4)})
    return sorted(matches, key=lambda match: -match["score"])[:3]


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    json.dump({"matches": rank_questions(payload["query"], payload["questions"])}, sys.stdout)
