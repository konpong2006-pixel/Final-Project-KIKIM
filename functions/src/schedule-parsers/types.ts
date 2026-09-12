export type StandardScheduleEntry = {
  buildingName?: string | null;
  classTime?: string | null;
  courseCode: string | null;
  courseName: string | null;
  day: string | null;
  endDate?: string | null;
  endTime: string | null;
  finalExam?: string | null;
  midtermExam?: string | null;
  parserSource?: string;
  raw?: string;
  /**
   * Fields the user should look at before saving: a model reading that the
   * OCR text does not bear out, or one that disagrees with what the grid read.
   */
  reviewFields?: string[];
  /** Why each of those fields was flagged, in Thai, for the review card. */
  reviewNotes?: string[];
  room: string | null;
  section?: string | null;
  startDate?: string | null;
  startTime: string | null;
};

export type ScheduleParserInput = {
  annotation?: unknown;
  imageDataUrl?: string;
  rawText: string;
};

export type ScheduleParserResult = {
  confidence: number;
  entries: StandardScheduleEntry[];
  institution: string;
  strategyId: string;
  usedLlm: boolean;
};

export type ScheduleParserStrategy = {
  detect: (text: string) => number;
  id: string;
  institution: string;
  parse: (input: ScheduleParserInput) => Promise<StandardScheduleEntry[]> | StandardScheduleEntry[];
};
