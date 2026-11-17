import {rowItem} from "./db/catalog.mjs";

// 회원이 완료한 공개 풀이와 고정 시연 표본을 합산
// 제출 횟수에는 재도전 포함, 태그별 첫 정답은 사람·문항별 최초 제출만 포함
export async function overviewStats(db) {
  const recorded = await db.all(`
    WITH ordered AS (
      SELECT user, item, correct,
             ROW_NUMBER() OVER (PARTITION BY user, item ORDER BY finish, rowid) AS position
      FROM geez_rounds WHERE finish IS NOT NULL
    )
    SELECT u.id AS user, u.nickname AS name, o.item, COUNT(*) AS total, SUM(o.correct) AS right,
           SUM(CASE WHEN position = 1 THEN correct ELSE 0 END) AS firstRight
    FROM ordered o JOIN geez_users u ON u.id = o.user
    GROUP BY u.id, u.nickname, o.item
    ORDER BY u.nickname, u.id
  `);
  const samples = await db.all(`
    SELECT a.profile, a.correct, q.tag
    FROM geez_demo_attempts a JOIN geez_questions q ON q.number = a.question
    ORDER BY a.rowid
  `);
  const tags = new Map();
  const profiles = new Map();
  let total = 0;
  let right = 0;

  function add(itemTags, count, wins, firstWins) {
    total += count;
    right += wins;
    for (const tag of itemTags) tags.set(tag, (tags.get(tag) || 0) + firstWins);
  }
  const members = new Map();
  for (const row of recorded) {
    const member = members.get(row.user) || {name: row.name, total: 0, right: 0};
    member.total += row.total;
    member.right += row.right;
    members.set(row.user, member);
    add(JSON.parse(row.item).tags, row.total, row.right, row.firstRight);
  }
  for (const {profile, correct, tag} of samples) {
    const entry = profiles.get(profile) || {name: profile, total: 0, right: 0};
    entry.total++;
    entry.right += correct;
    profiles.set(profile, entry);
    add(["일반상식", tag], 1, correct, correct);
  }
  const examples = [...profiles.values()];
  const users = [...examples, ...members.values()];
  return {
    total, right, participants: users.length, tags: Object.fromEntries(tags), users,
    members: members.size, examples
  };
}

// 공개 던전에서 풀어도 같은 내용의 문항은 같은 정답률에 반영
export async function questionStats(db, item) {
  const key = JSON.stringify(item);
  const counts = await db.first(`
    SELECT COUNT(*) AS total, COALESCE(SUM(correct), 0) AS right
    FROM geez_rounds WHERE finish IS NOT NULL AND item = ?
  `, key);
  const samples = await db.all(`
    SELECT q.*, a.correct
    FROM geez_demo_attempts a JOIN geez_questions q ON q.number = a.question
    WHERE q.question = ?
  `, item.question);
  let examples = 0;
  for (const row of samples) {
    if (JSON.stringify(rowItem(row)) !== key) continue;
    counts.total++;
    counts.right += row.correct;
    examples++;
  }
  return {...counts, examples};
}
