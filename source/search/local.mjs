import {execFile} from "node:child_process";
import {fileURLToPath} from "node:url";

const script = fileURLToPath(new URL("./similarity.py", import.meta.url));

// 배포용 Worker와 같은 Python 함수로 로컬 검색 실행
export function localSearch(payload) {
  return new Promise((resolve, reject) => {
    const command = process.env.GEEZ_PYTHON || (process.platform === "win32" ? "python" : "python3");
    const child =
        execFile(command, ["-X", "utf8", script], {timeout: 10000, windowsHide: true}, (err, stdout) => {
          if (err) {
            reject(Object.assign(
                new Error("Python 검색기를 실행할 수 없어요. Python 설치 경로를 확인해 주세요."),
                {status: 503}));
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch (error) {
            reject(error);
          }
        });
    child.stdin.on("error", () => {});  // 실행 실패는 종료 콜백에서 처리
    child.stdin.end(JSON.stringify(payload));
  });
}
