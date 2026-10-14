export const GOOGLE_WRITES_ENABLED = false;

export function googleCalendarWrite(): never {
  throw new Error("Запись в Google Calendar отключена.");
}

export interface CalendarEventDraft {
  summary: string;
  location: string;
  description: string;
}

export function calendarEventDraft(lesson: {
  title: string;
  room?: string;
  teacher?: string;
  group?: string;
  lessonType?: string;
}): CalendarEventDraft {
  const description = [
    lesson.room ? `Аудитория: ${lesson.room}` : "",
    lesson.teacher ? `Преподаватель: ${lesson.teacher}` : "",
    lesson.group ? `Группа: ${lesson.group}` : "",
  ].filter(Boolean);
  return {
    summary: lesson.title,
    location: lesson.room ?? "",
    description: description.join("\n"),
  };
}
