const axios = require('axios');
const logger = require('../utils/logger');

class ApiClient {
  constructor(baseURL, apiKey) {
    this.client = axios.create({
      baseURL,
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
      },
      timeout: 30000,
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('API request failed', {
          url: error.config?.url,
          status: error.response?.status,
          message: error.message,
        });
        throw error;
      }
    );
  }

  async get(endpoint, params = {}) {
    logger.debug(`GET ${endpoint}`, { params });
    const response = await this.client.get(endpoint, { params });

    const contentType = response.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      logger.warn(`Non-JSON response for ${endpoint}: ${contentType}`);
      return null;
    }

    return response.data;
  }

  async getWithRetry(endpoint, params = {}, maxRetries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.get(endpoint, params);
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          logger.warn(`Retry ${attempt}/${maxRetries} for ${endpoint} after ${delay}ms`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }
}

module.exports = ApiClient;
