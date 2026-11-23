import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setEntryPoint("./src/index.ts");
if (process.env.FABULOKI_BROWSER_PATH) Config.setBrowserExecutable(process.env.FABULOKI_BROWSER_PATH);
