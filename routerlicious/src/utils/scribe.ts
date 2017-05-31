import * as api from "../api";
import * as SharedString from "../merge-tree";
import { RateCounter } from "./counters";

export interface IScribeMetrics {
    // Average latency between when a message is sent and when it is ack'd by the server
    latencyAverage: number;
    latencyStdDev: number;

    // The rate of both typing messages and receiving replies
    ackRate: number;
    typingRate: number;

    // The progress of typing and reciving ack for messages in the range [0,1]
    typingProgress: number;
    ackProgress: number;
}

declare type ScribeMetricsCallback = (metrics: IScribeMetrics) => void;

/**
 * Processes the input text into a normalized form for the shared string
 */
function normalizeText(input: string): string {
    let result = "";
    const segments = SharedString.loadSegments(input, 0);
    for (const segment of segments) {
        result += (<SharedString.TextSegment> segment).text;
    }

    return result;
}

/**
 * Types the given file into the shared string - starting at the end of the string
 */
function typeFile(
    sharedString: SharedString.SharedString,
    fileText: string,
    intervalTime: number,
    callback: ScribeMetricsCallback): Promise<number> {

    const startTime = Date.now();

    return new Promise<number>((resolve, reject) => {
        let insertPosition = sharedString.client.getLength();
        let readPosition = 0;

        fileText = normalizeText(fileText);
        const metrics: IScribeMetrics = {
            ackProgress: undefined,
            ackRate: undefined,
            latencyAverage: undefined,
            latencyStdDev: undefined,
            typingProgress: undefined,
            typingRate: undefined,
        };

        // Trigger a new sample after a second has elapsed
        const samplingRate = 1000;

        const ackCounter = new RateCounter();
        ackCounter.reset();
        const latencyCounter = new RateCounter();
        latencyCounter.reset();
        const messageStart = {};

        let mean = 0;
        let stdDev = 0;

        sharedString.on("op", (message) => {
            if (message.clientSequenceNumber) {
                ackCounter.increment(1);
                if (ackCounter.elapsed() > samplingRate) {
                    const rate = ackCounter.getRate() * 1000;
                    metrics.ackRate = rate;
                    callback(metrics);

                    ackCounter.reset();
                }

                const roundTrip = Date.now() - messageStart[message.clientSequenceNumber];
                delete messageStart[message.clientSequenceNumber];
                latencyCounter.increment(roundTrip);
                metrics.latencyAverage = latencyCounter.getValue() / message.clientSequenceNumber;

                // Update std deviation using Welford's method
                stdDev = stdDev + (roundTrip - metrics.latencyAverage) * (roundTrip - mean);
                metrics.latencyStdDev =
                    message.clientSequenceNumber > 1 ? Math.sqrt(stdDev / (message.clientSequenceNumber - 1)) : 0;

                // Store the mean for use in the next round
                mean = metrics.latencyAverage;

                // We need a better way of hearing when our messages have been received and processed.
                // For now I just assume we are the only writer and wait to receive a message with a client
                // sequence number greater than the number of submitted operations.
                if (message.clientSequenceNumber >= fileText.length) {
                    const endTime = Date.now();
                    resolve(endTime - startTime);
                }

                // Notify of change in metrics
                metrics.ackProgress = message.clientSequenceNumber / fileText.length;
                callback(metrics);
            }
        });

        const typingCounter = new RateCounter();
        typingCounter.reset();

        function type(): boolean {
            // Stop typing once we reach the end
            if (readPosition === fileText.length) {
                return false;
            }

            typingCounter.increment(1);
            if (typingCounter.elapsed() > samplingRate) {
                const rate = typingCounter.getRate() * 1000;
                metrics.typingRate = rate;
                typingCounter.reset();
            }

            // Start inserting text into the string
            sharedString.insertText(fileText.charAt(readPosition++), insertPosition++);
            messageStart[readPosition] = Date.now();

            metrics.typingProgress = readPosition / fileText.length;
            callback(metrics);

            return true;
        }

        function typeFast() {
            setImmediate(() => {
                if (type()) {
                    typeFast();
                }
            });
        }

        // If the interval time is 0 and we have access to setImmediate (i.e. running in node) then make use of it
        if (intervalTime === 0 && typeof setImmediate === "function") {
            typeFast();
        } else {
            const interval = setInterval(() => {
                for (let i = 0; i < 1; i++) {
                    if (!type()) {
                        clearInterval(interval);
                        break;
                    }
                }
            }, intervalTime);
        }
    });
}

export function type(id: string, intervalTime: number, text: string, callback: ScribeMetricsCallback): Promise<number> {
    const extension = api.defaultRegistry.getExtension(SharedString.CollaboritiveStringExtension.Type);
    const sharedString = extension.load(id, api.getDefaultServices(), api.defaultRegistry) as SharedString.SharedString;

    return new Promise<number>((resolve, reject) => {
        sharedString.on("loadFinshed", (data: api.MergeTreeChunk) => {
            typeFile(sharedString, text, intervalTime, callback).then(
                (totalTime) => {
                    resolve(totalTime);
                },
                (error) => {
                    reject(error);
                });
        });
    });
}
