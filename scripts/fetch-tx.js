async function main() {
  const hash = '51fca225318759b2e72b032b31283dc1b5515a43c883af80686ad62a51c3b563';
  const res = await fetch(`https://horizon-testnet.stellar.org/transactions/${hash}/operations`);
  const data = await res.json();
  console.log(JSON.stringify(data._embedded.records, null, 2));
}

main();
