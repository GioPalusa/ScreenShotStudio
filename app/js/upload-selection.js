// A screenshot choice applies to the same canvas and slide in every language.
export const uploadImageKey = file => JSON.stringify([file.device, file.slide]);

export function uploadScreenGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const groupId = entry.groupId || (entry.choices.length === 1 ? entry.choices[0].id : '');
    const key = groupId || `canvas:${entry.device}`;
    if (!groups.has(key)) groups.set(key, { id: key, groupId, label: entry.choices.find(c => c.id === groupId)?.label ?? entry.canvas, devices: [], choices: entry.choices, images: [], maxCount: entry.choices.find(c => c.id === groupId)?.maxCount });
    const group = groups.get(key);
    group.choices = group.choices.filter(c => entry.choices.some(g => g.id === c.id));
    if (!group.devices.includes(entry.device)) group.devices.push(entry.device);
    if (!group.images.some(image => image.key === uploadImageKey(entry))) group.images.push({ ...entry, key: uploadImageKey(entry) });
  }
  return [...groups.values()];
}
