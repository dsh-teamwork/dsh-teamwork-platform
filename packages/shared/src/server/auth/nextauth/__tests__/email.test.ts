import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const { sendCodeEmail } = await import('../email');

describe('sendCodeEmail', () => {
  beforeEach(() => {
    sendMail.mockReset();
    createTransport.mockClear();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sends the code over the SMTP_URL transport', async () => {
    vi.stubEnv('SMTP_URL', 'smtp://mail.example.test:2525');
    vi.stubEnv('AUTH_EMAIL_FROM', 'DSH Teamwork <codes@example.test>');
    await expect(sendCodeEmail('a@example.test', '123456')).resolves.toBe(true);
    expect(createTransport).toHaveBeenCalledWith('smtp://mail.example.test:2525');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@example.test', from: 'DSH Teamwork <codes@example.test>', subject: expect.stringContaining('123456') }),
    );
  });

  it('refuses outside development without SMTP_URL, and never logs the code', async () => {
    vi.stubEnv('SMTP_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    await expect(sendCodeEmail('a@example.test', '123456')).resolves.toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
    const logged = [...vi.mocked(console.info).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(' ');
    expect(logged).not.toContain('123456');
  });

  it('prints the code in development without SMTP_URL', async () => {
    vi.stubEnv('SMTP_URL', '');
    vi.stubEnv('NODE_ENV', 'development');
    await expect(sendCodeEmail('a@example.test', '123456')).resolves.toBe(true);
    expect(vi.mocked(console.info).mock.calls.flat().join(' ')).toContain('123456');
  });

  it('reports a refused message without logging its contents', async () => {
    vi.stubEnv('SMTP_URL', 'smtp://mail.example.test:2525');
    sendMail.mockRejectedValueOnce(new Error('550 mailbox unavailable'));
    await expect(sendCodeEmail('a@example.test', '123456')).resolves.toBe(false);
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).not.toContain('123456');
  });
});
