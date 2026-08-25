/// <reference lib="webworker" />
import { installProcessorWorker, pdfMergeProcessor } from "@aio-converter/browser-processors";

installProcessorWorker(pdfMergeProcessor);
