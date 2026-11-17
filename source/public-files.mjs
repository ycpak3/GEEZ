// 로컬 서버와 배포 빌드에서 공통으로 제공할 정적 파일 목록
export const publicFiles = [
  "index.html", "style.css", "rules.js", "charts.js", "app.js",
  "workshop.js", "art/badge.svg", "art/dungeon.webp",
  ...Array.from({length: 9}, (_, index) => `art/m${index}.webp`)
];
