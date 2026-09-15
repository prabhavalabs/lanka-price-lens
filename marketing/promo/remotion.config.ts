import { Config } from "@remotion/cli/config";

// Lossless frames and a slow x264 pass: the video is short, quality matters more than render time.
Config.setVideoImageFormat("png");
Config.setCrf(16);
Config.setX264Preset("slow");
Config.setOverwriteOutput(true);
Config.setConcurrency(4);
