const RING = ['#e8590c', '#1971c2', '#2f9e44', '#9c36b5', '#c2255c', '#0c8599', '#f08c00'];
export const ringFor = (id = '') => RING[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % RING.length];
const initials = (name = '?') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export default function Avatar({ person, size = 28, title }) {
  return (
    <span className="pv-avatar" style={{ '--ring': ringFor(person.id), width: size, height: size }} title={title ?? `${person.name}${person.you ? ' (you)' : ''} · ${person.role === 'view' ? 'viewing' : 'editing'}`}>
      {person.avatar ? <img src={person.avatar} alt="" referrerPolicy="no-referrer" /> : initials(person.name)}
    </span>
  );
}
