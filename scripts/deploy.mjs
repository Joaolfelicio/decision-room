import { existsSync, readdirSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const SITE_ID = process.env.NETLIFY_SITE_ID || "534ce866-f2ab-4377-a38a-d002c823c0ba";
const args = new Set(process.argv.slice(2));
const isPreview = args.has("--preview");
const skipBuild = args.has("--skip-build");
const dryRun = args.has("--dry-run");

const rootDir = process.cwd();
const verifyScript = path.join(rootDir, "scripts", "verify-room-logic.mjs");
const tscBin = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");
const viteBin = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");
const functionFile = path.join(rootDir, "netlify", "functions", "room.mts");

const nodeDir = path.dirname(process.execPath);
const runEnv = {
  ...process.env,
  PATH: `${nodeDir}${path.delimiter}${process.env.PATH || ""}`,
};

function runNodeScript(scriptPath, scriptArgs, label) {
  console.log(`\n▶ ${label}...`);
  const res = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd: rootDir,
    env: runEnv,
    stdio: "inherit",
  });
  if (res.status !== 0) {
    console.error(`✖ Failed: ${label}`);
    process.exit(res.status ?? 1);
  }
}

function isWorkingNpxCli(cliPath) {
  if (!existsSync(cliPath)) return false;
  const check = spawnSync(process.execPath, [cliPath, "--version"], {
    cwd: rootDir,
    env: runEnv,
    stdio: "ignore",
  });
  return check.status === 0;
}

function findNpxCliJs() {
  const candidates = new Set([nodeDir]);
  try {
    candidates.add(path.dirname(realpathSync(process.execPath)));
  } catch {
    // ignore realpath issues
  }

  for (const dir of candidates) {
    const posixLib = path.resolve(dir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js");
    if (isWorkingNpxCli(posixLib)) return posixLib;

    const standard = path.join(dir, "node_modules", "npm", "bin", "npx-cli.js");
    if (isWorkingNpxCli(standard)) return standard;

    const nmDir = path.join(dir, "node_modules");
    if (existsSync(nmDir)) {
      for (const entry of readdirSync(nmDir)) {
        if (entry.startsWith(".npm-")) {
          const tempNpx = path.join(nmDir, entry, "bin", "npx-cli.js");
          if (isWorkingNpxCli(tempNpx)) return tempNpx;
        }
      }
    }
  }
  return null;
}

function resolveNetlifyRunner() {
  const isWin = process.platform === "win32";
  const netlifyCmd = isWin ? "netlify.cmd" : "netlify";
  const direct = spawnSync(netlifyCmd, ["--version"], {
    cwd: rootDir,
    env: runEnv,
    stdio: "ignore",
    shell: isWin,
  });
  if (direct.status === 0) {
    return { cmd: netlifyCmd, baseArgs: [], shell: isWin };
  }

  const npxCliJs = findNpxCliJs();
  if (npxCliJs) {
    return {
      cmd: process.execPath,
      baseArgs: [npxCliJs, "--yes", "netlify-cli@latest"],
      shell: false,
    };
  }

  console.error("✖ Neither `netlify` nor `npx` could be found.");
  process.exit(1);
}

if (!existsSync(tscBin) || !existsSync(viteBin)) {
  console.error("✖ Missing dependencies in node_modules. Run `npm install` first.");
  process.exit(1);
}

if (!skipBuild) {
  runNodeScript(verifyScript, [], "Verifying room logic & tie-breakers");
  runNodeScript(tscBin, ["--noEmit"], "Type-checking frontend TypeScript");
  runNodeScript(viteBin, ["build"], "Building Vite production bundle into dist/");
}

if (existsSync(functionFile)) {
  runNodeScript(
    tscBin,
    [
      "--noEmit",
      "--allowImportingTsExtensions",
      "--moduleResolution",
      "bundler",
      "--module",
      "esnext",
      "--target",
      "es2022",
      "--skipLibCheck",
      functionFile,
    ],
    "Checking Netlify Function (netlify/functions/room.mts)"
  );
}

if (!SITE_ID) {
  console.log("\n✓ Build & verification succeeded! Set NETLIFY_SITE_ID to deploy via CLI.");
  process.exit(0);
}

const deployMessage = process.env.GITHUB_SHA
  ? `GitHub push (${process.env.GITHUB_SHA.slice(0, 7)})`
  : `CLI deploy (${new Date().toISOString()})`;

const deployFlags = [
  "deploy",
  ...(isPreview ? [] : ["--prod"]),
  "--site",
  SITE_ID,
  "--message",
  deployMessage,
];

const runner = resolveNetlifyRunner();

if (dryRun) {
  console.log("\n✓ Dry run complete. Deploy command ready:");
  console.log(`  "${runner.cmd}" ${[...runner.baseArgs, ...deployFlags].join(" ")}`);
  process.exit(0);
}

console.log(`\n▶ Deploying to Netlify (${isPreview ? "Preview Draft" : "Production"})...`);
const deployRes = spawnSync(runner.cmd, [...runner.baseArgs, ...deployFlags], {
  cwd: rootDir,
  env: runEnv,
  stdio: "inherit",
  shell: runner.shell,
});

if (deployRes.status !== 0) {
  console.error("\n✖ Netlify deploy failed.");
  process.exit(deployRes.status ?? 1);
}
