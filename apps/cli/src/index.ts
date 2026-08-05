import { program } from "./commands/index.js";

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
