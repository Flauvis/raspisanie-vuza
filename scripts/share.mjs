import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readUpdateRepository } from "./update-repository.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "release", "raspisanie-vuza.zip");

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[byte] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function forbidden(name) {
  const parts = name.replaceAll("\\", "/").toLowerCase().split("/");
  if (parts.includes("node_modules") || parts.includes("oauth.public.json")) return true;
  return parts.some((part) => part.endsWith(".pem") || part.endsWith(".crx"));
}

function filesIn(directory, base = directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const name = `dist/${relative(base, path).split(sep).join("/")}`;
    if (forbidden(name)) throw new Error(`В сборке запрещённый файл: ${name}`);
    if (statSync(path).isDirectory()) files.push(...filesIn(path, base));
    else files.push({ path, name });
  }
  return files;
}

function zip(files) {
  const { time, day } = dosTime(new Date());
  const locals = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const data = readFileSync(file.path);
    const compressed = deflateRawSync(data);
    const name = Buffer.from(file.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(Buffer.concat([local, name, compressed]));

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(day, 14);
    header.writeUInt32LE(crc32(data), 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([header, name]));
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function entries(buffer) {
  let end = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 22 - 65535); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error("Архив повреждён: нет конца каталога");
  const count = buffer.readUInt16LE(end + 8);
  let offset = buffer.readUInt32LE(end + 16);
  const names = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Архив повреждён: каталог оборван");
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    names.push({ name, method, size, local });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function readEntry(buffer, entry) {
  if (buffer.readUInt32LE(entry.local) !== 0x04034b50) throw new Error(`Нет файла в архиве: ${entry.name}`);
  const nameLength = buffer.readUInt16LE(entry.local + 26);
  const extraLength = buffer.readUInt16LE(entry.local + 28);
  const start = entry.local + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.size);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`Неизвестный способ сжатия: ${entry.name}`);
}

const packageVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const builtVersion = JSON.parse(readFileSync(join(root, "dist", "manifest.json"), "utf8")).version;
if (builtVersion !== packageVersion) {
  throw new Error(`Версия dist ${builtVersion} не совпадает с package.json ${packageVersion}`);
}

const archive = zip(filesIn(join(root, "dist")));
const packed = entries(archive);
const blocked = packed.filter((entry) => forbidden(entry.name)).map((entry) => entry.name);
if (blocked.length > 0) throw new Error(`В архиве запрещённые файлы: ${blocked.join(", ")}`);
const manifest = packed.find((entry) => entry.name === "dist/manifest.json");
if (!manifest) throw new Error("В архиве нет dist/manifest.json");
const packedVersion = JSON.parse(readEntry(archive, manifest).toString("utf8")).version;
if (packedVersion !== packageVersion) {
  throw new Error(`Версия в архиве ${packedVersion} не совпадает с package.json ${packageVersion}`);
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, archive);
console.log(`${output} — версия ${packedVersion}, файлов ${packed.length}`);
publishRelease(packedVersion);

function publishRelease(version) {
  let repository = "";
  try {
    repository = readUpdateRepository(root);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "update.public.json не читается");
    process.exitCode = 1;
    return;
  }
  if (!repository) {
    console.log("Проверка обновлений у друзей выключена: заполните update.public.json по образцу update.public.example.json.");
    return;
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`Версия ${version} не публикуется: нужен номер вида 0.8.3.`);
    process.exitCode = 1;
    return;
  }
  const tag = `v${version}`;
  const gh = "gh";
  const view = spawnSync(gh, ["release", "view", tag, "--repo", repository], { encoding: "utf8" });
  if (view.error) {
    console.error("GitHub CLI не найден. Установите gh, выполните gh auth login и снова npm run share.");
    process.exitCode = 1;
    return;
  }
  const args = view.status === 0
    ? ["release", "upload", tag, output, "--repo", repository, "--clobber"]
    : ["release", "create", tag, output, "--repo", repository, "--title", version, "--notes", `Версия ${version}`];
  const published = spawnSync(gh, args, { stdio: "inherit" });
  if (published.status !== 0) {
    console.error("Выпуск на GitHub не создан. Архив на диске уже записан.");
    process.exitCode = 1;
    return;
  }
  console.log(`Выпуск ${tag}: https://github.com/${repository}/releases/tag/${tag}`);
}
