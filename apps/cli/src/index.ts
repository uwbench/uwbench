import { program } from "./commands/index.js";

const argv = [...process.argv];
if (argv[2] === "run" && argv.includes("--suite") && !argv.includes("--case")) {
  argv[2] = "suite";
}

program.parseAsync(argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
