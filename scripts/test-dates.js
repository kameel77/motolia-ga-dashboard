function getWarsawNow() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(new Date());
  console.log('Parts:', parts);
  const val = (name) => parseInt(parts.find(p => p.type === name)?.value || '0');
  
  const hour = val('hour');
  return new Date(Date.UTC(
    val('year'),
    val('month') - 1,
    val('day'),
    hour === 24 ? 0 : hour,
    val('minute'),
    val('second')
  ));
}

console.log('--- DATE TEST ---');
console.log('Current local system time:', new Date().toString());
console.log('Current UTC time:', new Date().toISOString());
const warsawNow = getWarsawNow();
console.log('getWarsawNow():', warsawNow.toISOString());
console.log('getWarsawNow() local representation:', warsawNow.toString());
