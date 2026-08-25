/// <reference lib="webworker" />
import { archiveZipProcessor, installProcessorWorker } from "@aio-converter/browser-processors";

installProcessorWorker(archiveZipProcessor);
