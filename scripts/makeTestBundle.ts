import { writeFileSync, mkdirSync } from 'fs';
import { writeMidi } from '../src/engine/midiWriter';
const dir = '/tmp/bundle';
mkdirSync(dir + '/Ilaiyaraaja', { recursive: true });
mkdirSync(dir + '/ARR', { recursive: true });
const names = ['Vaseegara', 'Chinna Chinna Aasai', 'Uyirin Uyire', 'Kanmani Anbodu', 'Ilaya Nila', 'Raja Raja Chozhan', 'Ennavale', 'Munbe Vaa', 'Nenjukkul Peidhidum', 'Kadhal Rojave', 'சின்ன சின்ன ஆசை', 'உயிரே'];
for (let i = 0; i < 30; i++) {
  const notes = Array.from({ length: 40 }, (_, k) => ({ tick: k * 240, duration: 200, pitch: 60 + ((k * (i + 2)) % 12) }));
  const bytes = writeMidi([{ name: 'Song', tempos: [{ tick: 0, bpm: 90 + i }] }, { name: 'Melody', notes }, { name: 'Strings', program: 48, channel: 1, notes: notes.map((n) => ({ ...n, pitch: n.pitch - 12 })) }]);
  const folder = i < 10 ? 'Ilaiyaraaja/' : i < 20 ? 'ARR/' : '';
  writeFileSync(`${dir}/${folder}${names[i % names.length]} ${i + 1}.mid`, bytes);
}
writeFileSync(`${dir}/broken.mid`, Buffer.from('MThd this is not really midi'));
writeFileSync(`${dir}/readme.txt`, 'hello');
console.log('ok');
