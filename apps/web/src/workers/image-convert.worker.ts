/// <reference lib="webworker" />
import { imageConvertProcessor, installProcessorWorker } from "@aio-converter/browser-processors";

installProcessorWorker(imageConvertProcessor);
