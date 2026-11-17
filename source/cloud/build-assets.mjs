import {copyFile, mkdir} from "node:fs/promises";
import {publicFiles} from "../public-files.mjs";

// 공개 목록에 있는 화면 파일을 원래 경로 구조로 복사
const source = new URL("../", import.meta.url);
const destination = new URL("../../.wrangler/public/", import.meta.url);

for (const file of publicFiles) {
  const output = new URL(file, destination);
  await mkdir(new URL(".", output), {recursive: true});
  await copyFile(new URL(file, source), output);
}
