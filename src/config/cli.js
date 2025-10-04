// CLI argument parser
export function parseCli(argv = process.argv.slice(2)) {
  const args = {};
  
  for (const tok of argv) {
    if (tok === '--dry-run') {
      args.dryRun = true;
    } else if (tok === '--write') {
      args.dryRun = false;
    } else if (tok.startsWith('--only-id=')) {
      args.onlyIds = tok.split('=')[1]
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(Boolean);
    } else if (tok.startsWith('--only-name=')) {
      args.onlyName = tok.split('=')[1];
    } else if (tok.startsWith('--name-regex=')) {
      args.nameRegex = new RegExp(tok.split('=')[1], 'i');
    } else if (tok.startsWith('--limit=')) {
      args.limit = parseInt(tok.split('=')[1], 10) || 0;
    } else if (tok.startsWith('--start-after-id=')) {
      args.startAfterId = parseInt(tok.split('=')[1], 10) || 0;
    } else if (tok === '--skip-images') {
      args.skipImages = true;
    } else if (tok === '--skip-custom-fields') {
      args.skipCustomFields = true;
    } else if (tok.startsWith('--location-id=')) {
      args.locationId = parseInt(tok.split('=')[1], 10) || 1;
    } else if (tok === '--debug-inventory') {
      args.debugInventory = true;
    }
  }
  
  return args;
}
