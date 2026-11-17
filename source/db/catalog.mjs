import "../rules.js";

// 풀이 기록과 동일한 필드 순서로 복원해 기존 기록과 같은 문항으로 인식
export function rowItem(row) {
  return {
    name: row.name,
    tags: ["일반상식", row.tag],
    art: row.art,
    question: row.question,
    choices: JSON.parse(row.choices),
    answers: JSON.parse(row.answers),
    explain: row.explanation,
    seconds: row.seconds
  };
}

// 탐색과 유사 문항 검색에서 사용하는 기본 몬스터·던전 목록 조회
export async function readCatalog(db) {
  const questions = await db.all("SELECT * FROM geez_questions ORDER BY number");
  const entries = questions.map(row => ({
    id: "g" + row.number,
    author: "Master",
    pack: GEEZ.single(rowItem(row))
  }));
  const items = new Map(questions.map((row, index) => [row.number, entries[index].pack.items[0]]));
  const members = await db.all(`
    SELECT d.number, d.name, d.tag, m.question
    FROM geez_dungeons d JOIN geez_dungeon_items m ON m.dungeon = d.number
    ORDER BY d.number, m.position
  `);
  const dungeons = new Map();
  for (const row of members) {
    if (!dungeons.has(row.number)) {
      dungeons.set(row.number, {name: row.name, tag: row.tag, items: []});
    }
    dungeons.get(row.number).items.push(items.get(row.question));
  }
  for (const [number, dungeon] of dungeons) {
    entries.push({
      id: "d" + number,
      author: "Master",
      pack: GEEZ.fromItems("dungeon", dungeon.name, dungeon.tag, dungeon.items)
    });
  }
  return entries;
}

// 단일 도전은 전체 목록을 읽지 않고 공개 ID와 던전 내 순번으로 한 문항 조회
export async function readPublicItem(db, id, index) {
  if (index < 0) return null;
  const builtin = /^([gd])([1-9]\d*)$/.exec(id);
  if (builtin) {
    const number = Number(builtin[2]);
    if (!Number.isSafeInteger(number)) return null;
    let row;
    if (builtin[1] === "g") {
      if (index !== 0) return null;
      row = await db.first("SELECT * FROM geez_questions WHERE number = ?", number);
    } else {
      row = await db.first(`
        SELECT q.* FROM geez_dungeon_items m
        JOIN geez_questions q ON q.number = m.question
        WHERE m.dungeon = ? AND m.position = ?
      `, number, index);
    }
    return row ? rowItem(row) : null;
  }
  const shared = await db.first("SELECT content FROM geez_packs WHERE id = ?", id);
  return shared ? JSON.parse(shared.content).items[index] : null;
}
