import json

from workers import Response, WorkerEntrypoint

from similarity import rank_questions


# 내부 서비스 바인딩에서 받은 후보 목록을 검색 함수에 전달
class Default(WorkerEntrypoint):
    async def fetch(self, request):
        if request.method != "POST":
            return Response("Method not allowed", status=405)
        payload = json.loads(await request.text())
        matches = rank_questions(payload["query"], payload["questions"])
        return Response(json.dumps({"matches": matches}, ensure_ascii=False),
                        headers={"Content-Type": "application/json; charset=utf-8"})
