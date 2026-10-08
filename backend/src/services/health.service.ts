import type { AuthModel } from '../models/auth.model.js';
export class HealthService {
  constructor(private model: Pick<AuthModel, 'checkReady'>) {}
  async checkReady() {
    await this.model.checkReady();
  }
}
