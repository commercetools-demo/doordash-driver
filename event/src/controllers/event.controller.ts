import { Request, Response } from 'express';
import CustomError from '../errors/custom.error';
import { logger } from '../utils/logger.utils';
import { handleOrderCreated } from './order.controller';

/**
 * Exposed event POST endpoint.
 * Receives the Pub/Sub message and works with it
 *
 * @param {Request} request The express request
 * @param {Response} response The express response
 * @returns
 */
export const post = async (request: Request, response: Response) => {
  // Check request body
  if (!request.body) {
    logger.error('Missing request body.');
    throw new CustomError(400, 'Bad request: No Pub/Sub message was received');
  }

  // Check if the body comes in a message
  if (!request.body.message) {
    logger.error('Missing body message');
    throw new CustomError(400, 'Bad request: Wrong No Pub/Sub message format');
  }

  // Receive the Pub/Sub message
  const pubSubMessage = request.body.message;

  // Decode the Pub/Sub message data
  const decodedData = pubSubMessage.data
    ? Buffer.from(pubSubMessage.data, 'base64').toString().trim()
    : undefined;

  if (!decodedData) {
    throw new CustomError(400, 'Bad request: No data in the Pub/Sub message');
  }

  const jsonData = JSON.parse(decodedData);

  logger.info(jsonData);

  try {
    switch (jsonData.type) {
      case 'OrderCreated':
        await handleOrderCreated(jsonData, response);
        break;
      
      
      default:
        logger.info(`Skipping message of type: ${jsonData.type}`);
        response.status(204).send();
    }
  } catch (error) {
    logger.error(`Error processing event: ${error}`);
    throw new CustomError(400, `Bad request: ${error}`);
  }
};
