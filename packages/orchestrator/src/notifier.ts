export class Notifier {
  private readonly botToken: string;
  private readonly chatId: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
    this.chatId = process.env.TELEGRAM_CHAT_ID ?? "";
  }

  async notifyReady(taskId: string, prNumber: number, prUrl: string): Promise<void> {
    await this.send(
      `PR Ready to Merge\n\nTask: ${taskId}\nPR: #${prNumber} ${prUrl}\n\nAll checks passed. Ready for your review.`
    );
  }

  async notifyFailed(taskId: string, attempts: number, lastError: string): Promise<void> {
    await this.send(
      `Task Needs Attention\n\nTask: ${taskId}\nAttempts: ${attempts}\n\nFailed after ${attempts} attempts.\nLast error: ${lastError.slice(0, 200)}`
    );
  }

  private async send(text: string): Promise<void> {
    if (!this.botToken || !this.chatId) {
      console.log(`[Notifier] ${text}`);
      return;
    }

    await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
  }
}
