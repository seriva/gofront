// Harness fixture: imports the helpers like test/perf scripts but never calls test().
import { compile } from "../../helpers.js";

const { errors } = compile("package main\nfunc main() {}\n");
process.stdout.write(`compiled with ${errors.length} errors\n`);
