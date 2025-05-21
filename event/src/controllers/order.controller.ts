import { Response } from 'express';
import { createApiRoot } from '../client/create.client';
import CustomError from '../errors/custom.error';
import { logger } from '../utils/logger.utils';
import { LineItem, Order, Channel } from '@commercetools/platform-sdk';
import jwt from 'jsonwebtoken';
import axios from 'axios';

/**
 * Generates a JWT token for DoorDash authentication
 * @returns JWT token
 */
const generateDoorDashJWT = () => {
  const data = {
    aud: 'doordash',
    iss: process.env.DOORDASH_DEVELOPER_ID,
    kid: process.env.DOORDASH_KEY_ID,
    exp: Math.floor(Date.now() / 1000 + 300),
    iat: Math.floor(Date.now() / 1000),
  };

  const headers = { algorithm: 'HS256', header: { 'dd-ver': 'DD-JWT-V1' } };

  // @ts-ignore
  return jwt.sign(
    data,
    Buffer.from(process.env.DOORDASH_SIGNING_KEY as string, 'base64'),
    headers
  );
};

/**
 * Creates a DoorDash delivery
 * @param order Order data
 * @param channel Channel data
 */
const createDoorDashDelivery = async (order: Order, channel: Channel) => {
  try {
    const token = generateDoorDashJWT();
    const shippingAddress = order.shippingAddress;
    
    if (!shippingAddress) {
      logger.error('Missing shipping address in order');
      return;
    }

    // Format the shipping address
    const dropoffAddress = `${shippingAddress.streetName} ${shippingAddress.streetNumber || ''} ${shippingAddress.city}, ${shippingAddress.state || ''} ${shippingAddress.postalCode}`;
    
    // Prepare request body
    const body = {
      external_delivery_id: order.id,
      pickup_address: channel.address
        ? `${channel.address.streetNumber || ''} ${channel.address.streetName} ${channel.address.city}, ${channel.address.state || ''} ${channel.address.postalCode}`
        : '',
      pickup_business_name: channel.name?.[process.env.DEFAULT_LOCALE!] || 'Default Pickup Location',
      pickup_phone_number:
        channel.custom?.fields?.phoneNumber || '+16505555555',
      pickup_instructions: channel.custom?.fields?.pickupInstructions || '',
      pickup_reference_tag: `Order number ${order.orderNumber}`,
      dropoff_address: dropoffAddress,
      dropoff_business_name:
        shippingAddress.company ||
        `${shippingAddress.firstName} ${shippingAddress.lastName}`,
      dropoff_phone_number: shippingAddress.phone || '+16505555555',
      dropoff_instructions: order.custom?.fields?.deliveryInstructions || '',
      order_value: order.totalPrice.centAmount
    };

    logger.info(`DoorDash delivery body: ${JSON.stringify(body)}`);

    // Make the API call to DoorDash
    const response = await axios.post(
      'https://openapi.doordash.com/drive/v2/deliveries',
      body,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    logger.info(`DoorDash delivery created: ${JSON.stringify(response.data)}`);
    return response.data;
  } catch (error) {
    logger.error(`Error creating DoorDash delivery: ${error}`);
    throw error;
  }
};

/**
 * Handles OrderCreated events by creating DoorDash deliveries when applicable
 * @param jsonData The event data
 * @param response The express response
 */
export const handleOrderCreated = async (jsonData: any, response: Response) => {
  const order: Order = jsonData.order;
  
  if (!order) {
    logger.error('No order data in the message');
    throw new CustomError(400, 'Bad request: No order data in the message');
  }

  // Check if shipping method is one of the configured ones
  const shippingMethodIDs = (process.env.SHIPPING_METHOD_IDS || '')
    .split(',')
    .map((id) => id.trim());
  const orderShippingMethodId = order.shippingInfo?.shippingMethod?.id;

  if (
    !orderShippingMethodId ||
    !shippingMethodIDs.includes(orderShippingMethodId)
  ) {
    logger.info(
      `Shipping method ID ${orderShippingMethodId} not in configured IDs: ${shippingMethodIDs}`
    );
    response.status(200).send();
    return;
  }

  // Find line item with price that has channel
  const lineItems: LineItem[] = order.lineItems || [];
  let channelId = null;

  for (const lineItem of lineItems) {
    if (lineItem.price?.channel?.id) {
      channelId = lineItem.price.channel.id;
      break;
    }
  }

  if (!channelId) {
    logger.info('No line item with channel found');
    response.status(200).send();
    return;
  }

  // Fetch channel information
  const apiRoot = createApiRoot();
  const channelResponse = await apiRoot
    .channels()
    .withId({ ID: channelId })
    .get()
    .execute();

  const channel = channelResponse.body;

  if (!channel) {
    logger.info(`Channel with ID ${channelId} not found`);
    response.status(200).send();
    return;
  }

  // Create DoorDash delivery
  await createDoorDashDelivery(order, channel);
  
  // Return success
  response.status(204).send();
}; 