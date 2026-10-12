import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// CSS는 postcss.config.js 의 @tailwindcss/postcss 플러그인이 처리합니다.
// GitHub Pages 프로젝트 주소(https://아이디.github.io/저장소이름/)에 맞게 BASE_PATH 로 경로를 지정합니다.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
});
