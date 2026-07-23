import { program } from "./commands.js";

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});