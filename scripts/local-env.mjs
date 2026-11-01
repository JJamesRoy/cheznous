#!/usr/bin/env node
// Runs a command with .env.local taking precedence over the shell environment.
// Guards against a shell that already exports another project's Supabase credentials.
// Usage: node scripts/local-env.mjs next dev
import { config } from "dotenv";
import { spawn } from "node:child_process";
import path from "node:path";

config({ path: ".env.local", quiet: true, override: true });
const [cmd, ...args] = process.argv.slice(2);
process.env.PATH = `${path.resolve("node_modules/.bin")}${path.delimiter}${process.env.PATH}`;
const child = spawn(cmd, args, { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
child.on("exit", (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 0)));
