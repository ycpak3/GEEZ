"use strict";

// 공통 척도로 첫 도전 정답 수를 비교하는 여섯 축 레이더 차트
function tagChart(values) {
  const tags = ["일반상식", ...GEEZ.subjects];
  const counts = tags.map(tag => Number(values[tag] || 0));
  const maximum = Math.max(4, Math.ceil(Math.max(...counts) / 4) * 4);
  const center = [180, 126];
  const radius = 78;

  function point(index, distance) {
    const angle = (index * 60 - 90) * Math.PI / 180;
    return [center[0] + distance * Math.cos(angle), center[1] + distance * Math.sin(angle)];
  }

  const polygon = distances => distances.map((distance, i) => point(i, distance).join(",")).join(" ");
  const rings =
      [1, 2, 3, 4]
          .map(n => `<polygon points="${polygon(tags.map(() => radius * n / 4))}" class="chart-ring"/>`)
          .join("");
  const axes =
      tags.map((tag, i) => {
            const [x, y] = point(i, radius);
            const [tx, ty] = point(i, radius + 21);
            const anchor = i === 0 || i === 3 ? "middle" : i < 3 ? "start" : "end";
            return `<line x1="${center[0]}" y1="${center[1]}" x2="${x}" y2="${y}" class="chart-ring"/>
            <text x="${tx}" y="${ty}" text-anchor="${anchor}" dominant-baseline="middle">${tag} ${
                counts[i]}</text>`;
          })
          .join("");
  const shape = counts.map(n => radius * n / maximum);
  const dots = shape
                   .map((distance, i) => {
                     const [x, y] = point(i, distance);
                     return `<circle cx="${x}" cy="${y}" r="3" class="chart-dot"/>`;
                   })
                   .join("");
  return `<figure class="radar"><svg viewBox="0 0 360 252" role="img"
    aria-label="태그별 첫 도전 정답 수. ${tags.map((tag, i) => tag + ' ' + counts[i] + '개').join(', ')}">
    ${rings}${axes}<polygon points="${polygon(shape)}" class="chart-shape"/>${dots}
    </svg><figcaption>한 눈금 ${
      maximum / 4}문항 · 일반상식은 다섯 분야의 공통 태그</figcaption></figure>`;
}

// 0회 제출과 정답률 0%를 구분하고 색 외에도 정답·오답 수를 표시
function rateBar(right, total) {
  if (!total) return '<p class="muted">아직 제출된 답안이 없어요.</p>';
  const percent = Math.round(right * 100 / total);
  return `<div class="rate"><strong>정답률 ${percent}%</strong>
    <span>정답 ${right}회 · 오답 ${total - right}회 · 총 ${total}회</span>
    <div class="track" aria-hidden="true"><i style="width:${right * 100 / total}%"></i></div></div>`;
}

// 초안의 질문과 정답은 전송하지 않고 공개 작품 ID와 던전 내 순번으로 조회
async function showQuestionStats(source) {
  const target = document.getElementById("question-stats");
  if (!target || !model.online || source.local || !source.id) return;
  target.innerHTML = '<h3>이 문항의 전체 정답 통계</h3><p>불러오는 중…</p>';
  try {
    const row = await api("question-stats", {id: source.id, index: source.index});
    if (!target.isConnected) return;
    target.innerHTML = '<h3>이 문항의 전체 정답 통계</h3>' + rateBar(row.right, row.total) +
        `<small>회원의 공개 풀이와 시연 풀이 ${row.examples}회 기준 · 재도전 포함</small>`;
  } catch {
    if (target.isConnected) target.innerHTML = '<p>문항 통계를 불러오지 못했어요.</p>';
  }
}

async function showCommunity() {
  const target = document.getElementById("community");
  if (!target) return;
  if (!model.online) {
    target.innerHTML = '<p>서버에 연결하면 전체 사용자 통계를 볼 수 있어요.</p>';
    return;
  }
  try {
    const data = await api("community");
    if (!target.isConnected) return;
    const max = data.users.reduce((n, row) => Math.max(n, row.total), 1);
    const rows = data.users.map(row => `
      <li><span>${esc(row.name)}</span>
        <progress value="${row.total}" max="${max}" aria-label="${esc(row.name)} 풀이 횟수"></progress>
        <span>풀이 ${row.total}회 · 정답 ${row.right}회</span></li>`).join("");
    target.innerHTML = `<div class="chart-layout"><div><h3>전체 태그별 첫 정답 수</h3>
      ${tagChart(data.tags)}</div><div><h3>참여자 ${data.participants}명 · 제출 ${data.total}회</h3>
      ${rateBar(data.right, data.total)}
      <h3>사용자별 풀이</h3><ul class="sample-bars">${rows}</ul></div></div>`;
  } catch {
    if (target.isConnected) target.textContent = "전체 통계를 불러오지 못했어요.";
  }
}
