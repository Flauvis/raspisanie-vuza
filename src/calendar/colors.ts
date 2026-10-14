export interface CalendarColor {
  id: string;
  name: string;
  background: string;
}

export const CALENDAR_COLORS: readonly CalendarColor[] = [
  { id: "1", name: "Коричневый", background: "#ac725e" },
  { id: "2", name: "Красный", background: "#d06b64" },
  { id: "3", name: "Ярко-красный", background: "#f83a22" },
  { id: "4", name: "Томатный", background: "#fa573c" },
  { id: "5", name: "Оранжевый", background: "#ff7537" },
  { id: "6", name: "Янтарный", background: "#ffad46" },
  { id: "7", name: "Зелёный", background: "#42d692" },
  { id: "8", name: "Тёмно-зелёный", background: "#16a765" },
  { id: "9", name: "Салатовый", background: "#7bd148" },
  { id: "10", name: "Лайм", background: "#b3dc6c" },
  { id: "11", name: "Светло-жёлтый", background: "#fbe983" },
  { id: "12", name: "Жёлтый", background: "#fad165" },
  { id: "13", name: "Мятный", background: "#92e1c0" },
  { id: "14", name: "Бирюзовый", background: "#9fe1e7" },
  { id: "15", name: "Голубой", background: "#9fc6e7" },
  { id: "16", name: "Синий", background: "#4986e7" },
  { id: "17", name: "Лавандовый", background: "#9a9cff" },
  { id: "18", name: "Фиолетовый", background: "#b99aff" },
  { id: "19", name: "Серый", background: "#c2c2c2" },
  { id: "20", name: "Бежевый", background: "#cabdbf" },
  { id: "21", name: "Пыльная роза", background: "#cca6ac" },
  { id: "22", name: "Розовый", background: "#f691b2" },
  { id: "23", name: "Сиреневый", background: "#cd74e6" },
  { id: "24", name: "Пурпурный", background: "#a47ae2" },
];

const COLOR_IDS = new Set(CALENDAR_COLORS.map((color) => color.id));

export function isCalendarColorId(value: string): boolean {
  return COLOR_IDS.has(value);
}
