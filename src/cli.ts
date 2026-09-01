export const version = '0.1.0';

export async function main(_argv: string[]): Promise<number> {
  process.stdout.write(`flowreel ${version}\n`);
  return 0;
}
