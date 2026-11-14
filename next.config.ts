import type { NextConfig } from "next";
import packageJson from "./package.json";

const nextConfig: NextConfig = {
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  // Type errors now fail the build (they were silently ignored before).
  typescript: { ignoreBuildErrors: false },
  // The app never uses next/image. Turning the optimiser off also disables the
  // /_next/image endpoint, which is reachable without login and has had RCE advisories.
  // 【中文】不使用 next/image；关闭图片优化器，同时关闭免登录可访问的 /_next/image 接口。
  images: { unoptimized: true },
  // The version shown in the sidebar is read from package.json at build time, so it can never
  // drift from the installer / updater version. 【中文】侧边栏显示的版本号在打包时从 package.json 读取，不会和安装程序版本不一致。
  env: { NEXT_PUBLIC_APP_VERSION: packageJson.version },
};

export default nextConfig;
