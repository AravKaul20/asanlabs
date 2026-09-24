/**
 * Loading the eval corpus from disk.
 *
 * A pair is a recording plus the label file beside it. Label files are the index:
 * anything named `*.labels.json` is read, and it names the recording it
 * describes. A recording with no label file is reported rather than silently
 * ignored, since an unlabelled clip is usually an oversight.
 */
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { getPose } from "@asan/poses";
import type { PoseDefinition } from "@asan/core";
import { labelSchema, recordingSchema, type LabelFile, type Recording } from "./schema.ts";

export interface CorpusEntry {
  name: string;
  labelPath: string;
  recordingPath: string;
  label: LabelFile;
  pose: PoseDefinition;
  recording: Recording;
}

export interface CorpusLoad {
  entries: CorpusEntry[];
  /** Human-readable problems that did not stop the run. */
  warnings: string[];
}

const LABEL_SUFFIX = ".labels.json";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadCorpus(dir: string): Promise<CorpusLoad> {
  const files = await readdir(dir);
  const labelFiles = files.filter((f) => f.endsWith(LABEL_SUFFIX)).sort();
  const entries: CorpusEntry[] = [];
  const warnings: string[] = [];

  const referenced = new Set<string>();

  for (const labelFile of labelFiles) {
    const labelPath = join(dir, labelFile);
    const parsedLabel = labelSchema.safeParse(await readJson(labelPath));
    if (!parsedLabel.success) {
      throw new Error(`${labelFile}: ${formatIssues(parsedLabel.error.issues)}`);
    }
    const label = parsedLabel.data;

    const pose = getPose(label.pose);
    if (!pose) {
      throw new Error(`${labelFile}: unknown pose "${label.pose}"`);
    }
    if (!pose.sides.includes(label.side)) {
      throw new Error(`${labelFile}: pose "${label.pose}" has no side "${label.side}"`);
    }

    const ruleIds = new Set(pose.rules.map((r) => r.id));
    for (const mistake of label.mistakes) {
      if (!ruleIds.has(mistake.ruleId)) {
        throw new Error(
          `${labelFile}: mistake references rule "${mistake.ruleId}", which pose "${pose.id}" does not define`,
        );
      }
    }

    const recordingPath = join(dir, label.recording);
    referenced.add(basename(label.recording));
    const parsedRecording = recordingSchema.safeParse(await readJson(recordingPath));
    if (!parsedRecording.success) {
      throw new Error(`${label.recording}: ${formatIssues(parsedRecording.error.issues)}`);
    }

    entries.push({
      name: labelFile.slice(0, -LABEL_SUFFIX.length),
      labelPath,
      recordingPath,
      label,
      pose,
      recording: parsedRecording.data,
    });
  }

  for (const file of files) {
    if (file.endsWith(LABEL_SUFFIX) || !file.endsWith(".json")) continue;
    if (!referenced.has(file)) warnings.push(`${file} has no ${LABEL_SUFFIX} file and was skipped`);
  }

  return { entries, warnings };
}

function formatIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 5)
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}
