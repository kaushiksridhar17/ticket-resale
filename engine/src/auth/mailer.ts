export type SendCode = (email: string, code: string) => Promise<void> | void;

export function consoleMailer(): SendCode {
  return (email, code) => {
    console.log(`[auth] sign-in code for ${email}: ${code}`);
  };
}