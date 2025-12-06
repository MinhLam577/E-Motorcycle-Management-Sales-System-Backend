import {
  BadRequestException,
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import axios from 'axios';
import * as qs from 'qs';
import moment from 'moment';
import { CreateZaloPaymentDto } from './dto/create-zalo-payment.dto';
import { OrderService } from '../order/order.service';
import { ResponseOrderDto } from '../order/dto/response-order.dto';
import { generateMac } from 'src/helpers/utils';
import { InjectRepository } from '@nestjs/typeorm';
import { Order } from '../order/entities/order.entity';
import { Raw, Repository } from 'typeorm';
import { PaymentMethodOptionService } from '../payment_method_option/payment_method_option.service';
import { OrderPaymentMethodOption } from '../order_payment_method_option/entities/order_payment_method_option.entity';
import {
  order_status,
  payment_method_name,
  payment_status,
} from 'src/constants/order_status.enum';
import { Cron, CronExpression } from '@nestjs/schedule';
import { API_Header_Content_Type_Format } from 'src/constants';
import { ZaloPayCheckOrderStatus } from 'src/constants/zalo-payment.enum';
import appConfig from 'src/config/app.config';
interface CreateZaloPayOrderDto {
  app_id: number;
  app_user: string;
  app_trans_id: string;
  app_time: number;
  expire_duration_seconds?: number;
  amount: number;
  item?: string; // 	Item của đơn hàng. Dữ liệu dạng JSON
  description?: string;
  embed_data: string; // Dữ liệu riêng của đơn hàng. Dữ liệu này sẽ được callback lại cho AppServer khi thanh toán thành công. Dữ liệu dạng JSON
  bank_code?: string;
  mac: string;
  callback_url?: string; // ZaloPay sẽ thông báo trạng thái thanh toán của đơn hàng khi thanh toán hoàn tất.
  title?: string;
  currency?: string; // Loại tiền tệ của đơn hàng. Mặc định là VND
  phone?: string;
  email?: string;
  address?: string;
}

const redirectUrl = `${appConfig().FE_URL_USER}/purchase`;
export const callback_url = `${process.env.DEPLOYMENT_URL}/api/v1/zalo-payment/callback`;
export const ZaloPay_query_url = 'https://sb-openapi.zalopay.vn/v2/query';
const cancel_url = 'https://sb-openapi.zalopay.vn/v2/cancel';
export const appId = 2553;
export const key1 = 'PcY4iZIKFCIdgZvA6ueMcMHHUbRLYjPL';
export const key2 = 'kLtgPl8HHhfvMuDHPwKfgfsY4Ydm9eIz';
// export const appId = 554;
// export const key1 = '8NdU5pG5R2spGHGhyO99HN1OhD8IQJBn';
// export const key2 = 'uUfsWgfLkRLzq6W2uNXTCxrfxs51auny';
export const createOrderZaloPayURL = 'https://sb-openapi.zalopay.vn/v2/create';
const refundOrderZaloPayEndPoint = 'https://sb-openapi.zalopay.vn/v2/refund';
const queryRefundEndPoint = 'https://sb-openapi.zalopay.vn/v2/query_refund';
const expire_duration_seconds = 900;
export const ZaloPayConfig = {
  app_id: appId,
  key1: key1,
  key2: key2,
  endpoint: createOrderZaloPayURL,
  callback_url: callback_url,
};
interface queryOrderRefund {
  app_id: number;
  m_refund_id: string;
  timestamp: number;
  mac: string;
}
export interface ZaloOrderStatus {
  app_id: number;
  app_trans_id: string;
  mac: string;
}

export const enum ZaloPaySaveDatabaseKey {
  app_trans_id = 'app_trans_id',
  zp_trans_id = 'zp_trans_id',
  m_refund_id = 'm_refund_id',
}

interface SavePaymentUrl {
  zp_trans_token: string;
  order_url: string;
  cashier_order_url: string;
  order_token: string;
  qr_code: string;
}

interface RefundOrderInterface {
  m_refund_id: string;
  app_id: string;
  zp_trans_id: string;
  amount: number;
  refund_fee_amount?: number;
  timestamp: number;
  mac: string;
  description: string;
}

@Injectable()
export class ZaloPaymentService {
  constructor(
    @Inject(forwardRef(() => OrderService))
    private readonly orderService: OrderService,
    private readonly paymentMethodOptionService: PaymentMethodOptionService,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderPaymentMethodOption)
    private readonly orderPaymentMethodOptionRepository: Repository<OrderPaymentMethodOption>,
  ) {}
  private config = {
    app_id: appId,
    key1: key1,
    key2: key2,
    createPaymentZaloPayEndpoint: createOrderZaloPayURL,
    callback_url: callback_url,
  };

  private validateOrderInfo(order: ResponseOrderDto | Order) {
    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }
    const orderData = order;
    const order_detail =
      order instanceof Order ? order.orderDetails : order.order_details;
    if (order_detail.length === 0) {
      throw new NotFoundException(
        `Đơn hàng #${orderData.id} không có sản phẩm nào`,
      );
    }
    const total_price = orderData.total_price;
    const discount_price = orderData.discount_price;
    const customerName = orderData.customer.username;
    const email = orderData.customer.email;
    const phone = orderData.customer.phoneNumber;
    return {
      total_price,
      discount_price,
      order_detail,
      customerName,
      email,
      phone,
    };
  }

  private convertUUIDToAppTransId(uuid: string, appId?: string) {
    const uuidConvert = uuid.replace(/-/g, '');
    if (appId) {
      return `${moment().format('YYMMDD')}_${appId}_${uuidConvert}`;
    }
    return `${moment().format('YYMMDD')}_${uuidConvert}`;
  }

  private async validateCreateOrder(orderInfo: CreateZaloPaymentDto) {
    const { orderId } = orderInfo;
    const [orderData, paymentMethodOptionRes] = await Promise.all([
      this.orderService
        .findOne(orderId, false)
        .then((res) => res.data as Order),
      this.paymentMethodOptionService.findOneByName(
        ZaloPaySaveDatabaseKey.app_trans_id,
      ),
    ]);
    const paymentMethodOption = paymentMethodOptionRes.data;
    if (
      orderData.OrderPaymentMethodOptions &&
      orderData.OrderPaymentMethodOptions instanceof Array &&
      orderData.OrderPaymentMethodOptions.length > 0
    ) {
      throw new BadRequestException(
        `Order #${orderId} đã hoặc đang trong quá trình thanh toán trước đó`,
      );
    }
    if (!paymentMethodOption) {
      throw new NotFoundException(
        `Thiếu ${ZaloPaySaveDatabaseKey.app_trans_id} trong quá trình tạo đơn hàng`,
      );
    }
    return { orderData, paymentMethodOption };
  }

  private async handleCreateOrderData(
    orderData: Order,
    orderId: string,
    description: string,
  ) {
    const { total_price, customerName, email, phone, discount_price } =
      this.validateOrderInfo(orderData);
    const title = 'Thanh toán đơn hàng từ Oto Hong Son';
    const embed_data = {
      // link web chuyển đến khi thanh toán thành công
      redirecturl: redirectUrl,
    };

    const app_id = this.config.app_id;
    const app_user = customerName;

    const app_trans_id = this.convertUUIDToAppTransId(orderId);
    const app_time = Date.now();
    const expire_time = app_time + expire_duration_seconds * 1000;
    const amount = Math.ceil(20000);
    const item = JSON.stringify([
      {
        orderId: orderId,
        total_price: total_price,
      },
    ]);
    const embed_data_json = JSON.stringify(embed_data);
    const desc = description;
    const bank_code = '';

    const generate_mac_data = `${app_id}|${app_trans_id}|${app_user}|${amount}|${app_time}|${embed_data_json}|${item}`;

    const mac = generateMac(generate_mac_data, this.config.key1);

    const orderPayment: CreateZaloPayOrderDto = {
      app_id,
      app_user,
      app_trans_id,
      app_time,
      amount,
      item,
      description: desc,
      embed_data: embed_data_json,
      bank_code,
      expire_duration_seconds,
      mac,
      title,
      callback_url,
      phone,
      email,
    };

    const result = await axios.post(
      this.config.createPaymentZaloPayEndpoint,
      qs.stringify(orderPayment),
      {
        headers: {
          'Content-Type': API_Header_Content_Type_Format.FORM,
        },
      },
    );

    const responseData = result.data;
    this.validateResponseZalopay(responseData);

    return { responseData, expire_time, app_trans_id };
  }

  private validateResponseZalopay(
    responseData: any,
    type = payment_status.PENDING,
  ): void {
    switch (responseData.return_code) {
      case 1: // SUCCESS
        return;
      case 2: // FAIL
        throw new UnprocessableEntityException(
          `Lỗi từ ZaloPay: [Code: ${responseData.return_code}] - ${responseData.return_message} | SubCode: ${responseData.sub_return_code || 'N/A'} - ${responseData.sub_return_message || 'N/A'}`,
        );
      case 3: // PROCESSING
        if (type !== payment_status.REFUNDED) {
          throw new HttpException(
            {
              message: `ZaloPay status: [Code: ${responseData.return_code}] ${responseData.return_message}`,
              subCode: responseData.sub_return_code || 'N/A',
              subMessage: responseData.sub_return_message || 'N/A',
              data: responseData, // Trả về toàn bộ response nếu cần
            },
            HttpStatus.ACCEPTED, // 202 Accepted
          );
        }
        return;
      default:
        throw new BadRequestException(
          `Lỗi từ ZaloPay: [Code: ${responseData.return_code}] ${responseData.return_message} | SubCode: ${responseData.sub_return_code || 'N/A'} - ${responseData.sub_return_message || 'N/A'}`,
        );
    }
  }

  async createOrder(orderInfo: CreateZaloPaymentDto): Promise<any> {
    try {
      const { description, orderId } = orderInfo;
      return await this.orderRepository.manager.transaction(async (manager) => {
        const { orderData, paymentMethodOption } =
          await this.validateCreateOrder(orderInfo);

        const { responseData, expire_time, app_trans_id } =
          await this.handleCreateOrderData(orderData, orderId, description);

        const savePaymentUrlData: SavePaymentUrl = {
          zp_trans_token: responseData.zp_trans_token,
          order_url: responseData.order_url,
          cashier_order_url: responseData.cashier_order_url,
          order_token: responseData.order_token,
          qr_code: responseData.qr_code,
        };

        orderData.payment_url = JSON.stringify(savePaymentUrlData);
        orderData.payment_url_expired = new Date(expire_time);
        const newOrderPaymentMethodOption = manager.create(
          OrderPaymentMethodOption,
          {
            order: { id: orderData.id },
            paymentMethodOption: { id: paymentMethodOption.id },
            value: app_trans_id,
          },
        );

        const saveOrder = await manager.save(Order, orderData);
        await manager.save(
          manager.create(OrderPaymentMethodOption, newOrderPaymentMethodOption),
        );
        return {
          status: 200,
          message: 'Order created successfully',
          data: {
            orderId: saveOrder.id,
            response: savePaymentUrlData,
          },
        };
      });
    } catch (e) {
      console.error('Create order zalopay failed: ', e);
      throw e;
    }
  }
  // Zalo pay gọi đến callback API  khi thanh toán thành công  -> cập nhật trạng thái đơn hàng
  async verifyCallback(body: any) {
    let result = { return_code: 0, return_message: 'Lỗi từ server' };

    try {
      await this.orderRepository.manager.transaction(async (manager) => {
        const { data, mac } = body; // Nhận data và mac từ body
        // Tạo MAC từ dữ liệu nhận được
        const verifyMac = generateMac(data, this.config.key2);

        // Kiểm tra xem MAC có hợp lệ không
        if (mac !== verifyMac) {
          // Nếu MAC không hợp lệ, trả về lỗi
          return { return_code: -1, return_message: 'MAC không hợp lệ' };
        } else {
          // Nếu MAC hợp lệ, kiểm tra thông tin thanh toán
          const dataJson = JSON.parse(data);
          const item = dataJson['item'];

          const app_trans_id = dataJson[ZaloPaySaveDatabaseKey.app_trans_id];
          const zp_trans_id = dataJson[ZaloPaySaveDatabaseKey.zp_trans_id];

          const [existingOrder, payment_method_option] = await Promise.all([
            manager.findOne(Order, {
              where: {
                OrderPaymentMethodOptions: {
                  value: app_trans_id,
                },
              },
              relations: [
                'OrderPaymentMethodOptions',
                'OrderPaymentMethodOptions.paymentMethodOption',
              ],
            }),
            this.paymentMethodOptionService
              .findOneByName(ZaloPaySaveDatabaseKey.zp_trans_id)
              .then((res) => res.data),
          ]);

          if (!existingOrder) {
            return { return_code: 0, return_message: 'Không tìm thấy hóa đơn' };
          }

          if (!payment_method_option) {
            return {
              return_code: 0,
              return_message: `Không tìm thấy ${ZaloPaySaveDatabaseKey.app_trans_id} trong quá trình xác nhận thanh toán`,
            };
          }

          const new_order_payment_option = manager.create(
            OrderPaymentMethodOption,
            {
              order: existingOrder,
              paymentMethodOption: payment_method_option,
              value: zp_trans_id,
            },
          );

          existingOrder.payment_time = new Date();
          existingOrder.payment_status = payment_status.PAID;

          await manager.save(Order, existingOrder);
          await manager.save(
            OrderPaymentMethodOption,
            new_order_payment_option,
          );
          return {
            return_code: 1,
            return_message: 'Giao dịch thành công',
          };
        }
      });
    } catch (e: any) {
      console.error(e);
      const message = e?.message || 'Lỗi xử lí callback từ ZaloPay';
      return { return_code: 0, return_message: message };
    }

    return result;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkPendingPaymentOrder() {
    try {
      const orders = await this.orderRepository.find({
        where: {
          payment_status: payment_status.PENDING,
          payment_url_expired: Raw((p) => `${p} IS NOT NULL AND ${p} >= NOW()`),
          paymentMethod: { name: payment_method_name.ZALOPAY },
        },
        relations: ['paymentMethod'],
      });
      for (const order of orders) {
        try {
          const order_id = order.id;
          await this.checkOrderStatus(order_id);
        } catch (e) {}
      }
    } catch (e) {
      throw e;
    }
  }

  async checkOrderStatus(order_id: string) {
    const order = (
      await this.orderService.findOne(order_id, false, [
        'OrderPaymentMethodOptions',
        'OrderPaymentMethodOptions.paymentMethodOption',
      ])
    ).data as Order;
    const app_trans_id = order.OrderPaymentMethodOptions.find(
      (o) => o.paymentMethodOption.name === ZaloPaySaveDatabaseKey.app_trans_id,
    )?.value;
    if (!app_trans_id)
      throw new NotFoundException(
        ZaloPayCheckOrderStatus.NOT_FOUND_404_APP_TRANSACTION_ID,
      );
    const postData: ZaloOrderStatus = {
      app_id: this.config.app_id,
      app_trans_id: app_trans_id,
      mac: '',
    };
    // Tạo MAC từ app_id, app_trans_id và key1
    const data = `${postData.app_id}|${postData.app_trans_id}|${this.config.key1}`;
    postData.mac = generateMac(data, this.config.key1);
    const postConfig = {
      method: 'post',
      url: ZaloPay_query_url,
      headers: {
        'Content-Type': API_Header_Content_Type_Format.FORM,
      },
      data: qs.stringify(postData),
    };
    try {
      const result = await axios(postConfig);
      const resData = result.data;
      let transaction_status = 'N/A';
      let status_code = 500;
      const zp_trans_id = resData.zp_trans_id;
      const paymentMethod = await this.paymentMethodOptionService
        .findOneByName(ZaloPaySaveDatabaseKey.zp_trans_id)
        .then((res) => res.data);
      const existing_Zp_Trans_Id = order.OrderPaymentMethodOptions.find(
        (o) =>
          o.paymentMethodOption.name === ZaloPaySaveDatabaseKey.zp_trans_id,
      );
      if (!paymentMethod)
        throw new NotFoundException(
          `Không tìm thấy ${ZaloPaySaveDatabaseKey.zp_trans_id} trong phiên giao dịch`,
        );
      if (order.payment_status === payment_status.PAID) {
        return {
          status: 200,
          message: 'Đơn hàng đã được thanh toán trước đó',
          data: {
            transaction_status: ZaloPayCheckOrderStatus.SUCCESS,
            detail: resData,
          },
        };
      }
      switch (resData.return_code) {
        case 1: // SUCCESS
          transaction_status = ZaloPayCheckOrderStatus.SUCCESS;
          order.payment_status = payment_status.PAID;
          order.payment_time = new Date();
          status_code = 200;
          order.order_status = order_status.PENDING;
          break;
        case 2: // FAIL
          transaction_status = ZaloPayCheckOrderStatus.FAILED;
          order.payment_status = payment_status.FAILED;
          status_code = 200;
          order.order_status = order_status.CANCELLED;
          break;
        case 3: // PROCESSING
          const currentTime = new Date().getTime();
          const expire_time = order.payment_url_expired.getTime();
          if (currentTime > expire_time) {
            order.payment_status = payment_status.FAILED;
            order.order_status = order_status.CANCELLED;
            transaction_status = ZaloPayCheckOrderStatus.FAILED;
            status_code = 410;
          } else {
            transaction_status = ZaloPayCheckOrderStatus.PROCESSING;
            order.payment_status = payment_status.PENDING;
            order.order_status = order_status.PENDING;
            status_code = 202;
          }
          break;
        default:
          transaction_status = ZaloPayCheckOrderStatus.UNKNOWN;
          order.payment_status = payment_status.FAILED;
          order.order_status = order_status.CANCELLED;
          break;
      }
      await this.orderRepository.manager.transaction(async (manager) => {
        await manager.save(Order, order);
        if (!existing_Zp_Trans_Id) {
          await manager.save(
            manager.create(OrderPaymentMethodOption, {
              order: { id: order_id },
              paymentMethodOption: { id: paymentMethod.id },
              value: zp_trans_id,
            }),
          );
        } else {
          existing_Zp_Trans_Id.value = zp_trans_id;
          await manager.save(OrderPaymentMethodOption, existing_Zp_Trans_Id);
        }
      });
      return {
        status: status_code,
        message: ZaloPayCheckOrderStatus.SUCCESS_200,
        data: {
          transaction_status,
          detail: resData,
        },
      };
    } catch (e) {
      throw e;
    }
  }

  // async refundOrder(
  //   order_id: string,
  //   reason?: string,
  //   baseManager?: EntityManager,
  // ) {
  //   const managerRepo = baseManager || this.orderRepository.manager;
  //   try {
  //     if (!baseManager) {
  //       return await this.orderRepository.manager.transaction(
  //         async (manager) => {
  //           return await this.executeRefundOrder(order_id, manager, reason);
  //         },
  //       );
  //     } else {
  //       return await this.executeRefundOrder(order_id, managerRepo, reason);
  //     }
  //   } catch (e) {
  //     throw e;
  //   }
  // }

  // private async executeRefundOrder(
  //   order_id: string,
  //   manager: EntityManager,
  //   reason?: string,
  // ) {
  //   const [order, paymentMethodOption] = await Promise.all([
  //     this.orderService
  //       .findOne(order_id, false, [
  //         'OrderPaymentMethodOptions',
  //         'OrderPaymentMethodOptions.paymentMethodOption',
  //       ])
  //       .then((res) => res.data as Order),
  //     this.paymentMethodOptionService
  //       .findOneByName(ZaloPaySaveDatabaseKey.m_refund_id)
  //       .then((res) => res.data),
  //   ]);
  //   const existingRefundData = order.OrderPaymentMethodOptions.find(
  //     (o) => o.paymentMethodOption.name === ZaloPaySaveDatabaseKey.m_refund_id,
  //   );

  //   const existing_Zp_Trans_Id = order.OrderPaymentMethodOptions.find(
  //     (o) => o.paymentMethodOption.name === ZaloPaySaveDatabaseKey.zp_trans_id,
  //   );
  //   if (existingRefundData) {
  //     throw new BadRequestException(`Order #${order_id} has been refunded`);
  //   }

  //   if (!existing_Zp_Trans_Id) {
  //     throw new BadRequestException(`Order #${order_id} has not been paid`);
  //   }

  //   if (order.payment_status === payment_status.FAILED) {
  //     throw new BadRequestException(
  //       `Order #${order_id} payment has been failed`,
  //     );
  //   }

  //   if (order.payment_status === payment_status.PENDING) {
  //     throw new BadRequestException(`Order #${order_id} has not been paid`);
  //   }

  //   if (order.payment_status === payment_status.REFUNDED) {
  //     throw new BadRequestException(`Order #${order_id} has been refunded`);
  //   }

  //   const zp_trans_id = existing_Zp_Trans_Id.value;
  //   const amount = Math.ceil(order.total_price);
  //   const description = 'Hoàn tiền đơn hàng từ Oto Hong Son';
  //   const timestamp = Date.now();
  //   const m_refund_id = this.convertUUIDToAppTransId(order_id, appId);
  //   const data = `${appId}|${zp_trans_id}|${amount}|${description}|${timestamp}`;
  //   const mac = generateMac(data, key1);
  //   const refundOrder: RefundOrderInterface = {
  //     m_refund_id: m_refund_id,
  //     app_id: appId,
  //     zp_trans_id: zp_trans_id,
  //     amount: amount,
  //     timestamp: timestamp,
  //     mac: mac,
  //     description: description,
  //   };
  //   const postConfig = {
  //     method: 'post',
  //     url: refundOrderZaloPayEndPoint,
  //     headers: {
  //       'Content-Type': API_Header_Content_Type_Format.FORM,
  //     },
  //     data: qs.stringify(refundOrder),
  //   };

  //   const result = await axios(postConfig);
  //   const resData = result.data;
  //   this.validateResponseZalopay(resData, payment_status.REFUNDED);
  //   const saveRefundOrder = await manager.save(
  //     manager.create(OrderPaymentMethodOption, {
  //       order: order,
  //       paymentMethodOption: paymentMethodOption,
  //       value: m_refund_id,
  //     }),
  //   );
  //   if (reason) {
  //     order.refund_reason = reason;
  //   }
  //   await manager.save(Order, order);
  //   const newRefundOrderDto: RefundOrderDto = {
  //     amount,
  //     timestamp,
  //     reason,
  //     orderId: order_id,
  //     m_refund_id,
  //     id: saveRefundOrder.id,
  //   };
  //   const responseDto: ResponseZaloPay = {
  //     return_code: resData.return_code,
  //     return_message: resData.return_message,
  //     sub_return_code: resData.sub_return_code,
  //     sub_return_message: resData.sub_return_message,
  //     refund_id: resData.refund_id,
  //   };

  //   const ResponseZaloPayRefundOrderDto: ResponseZaloPayRefundOrderDto = {
  //     refundOrder: newRefundOrderDto,
  //     response: responseDto,
  //   };
  //   return {
  //     status: 200,
  //     message: ZaloPayRefundOrderStatus.SUCCESS_200,
  //     data: ResponseZaloPayRefundOrderDto,
  //   };
  // }

  // async checkRefundOrderStatus(order_id: string): Promise<{
  //   status: number;
  //   message: string;
  //   sub_message: string;
  //   detail: ResponseCheckRefundDto;
  // }> {
  //   try {
  //     const [order] = await Promise.all([
  //       this.orderService
  //         .findOne(order_id, false, [
  //           'OrderPaymentMethodOptions',
  //           'OrderPaymentMethodOptions.paymentMethodOption',
  //         ])
  //         .then((res) => res.data as Order),
  //     ]);

  //     const existingRefundOrder = order.OrderPaymentMethodOptions.find(
  //       (o) =>
  //         o.paymentMethodOption.name === ZaloPaySaveDatabaseKey.m_refund_id,
  //     );

  //     if (!existingRefundOrder) {
  //       throw new BadRequestException(
  //         `Order #${order_id} has not been refunded`,
  //       );
  //     }

  //     const m_refund_id = existingRefundOrder.value;
  //     const timestamp = Date.now();
  //     const data = `${appId}|${m_refund_id}|${timestamp}`;
  //     const mac = generateMac(data, key1);
  //     const queryOrderRefund: queryOrderRefund = {
  //       app_id: appId,
  //       m_refund_id: m_refund_id,
  //       timestamp: timestamp,
  //       mac: mac,
  //     };
  //     const postConfig = {
  //       method: 'post',
  //       url: queryRefundEndPoint,
  //       headers: {
  //         'Content-Type': 'application/x-www-form-urlencoded',
  //       },
  //       data: qs.stringify(queryOrderRefund),
  //     };

  //     const result = await axios(postConfig);
  //     const resData = result.data;
  //     if (resData.return_code == 2) {
  //       throw new BadRequestException(
  //         `ZaloPay error: [Code: ${resData.return_code}] ${resData.return_message} | SubCode: ${resData.sub_return_code || 'N/A'} - ${resData.sub_return_message || 'N/A'}`,
  //       );
  //     }

  //     const ResponseCheckRefundDto: ResponseCheckRefundDto = {
  //       orderId: order_id,
  //       return_code: resData.return_code,
  //       return_message: resData.return_message,
  //       sub_return_code: resData.sub_return_code,
  //       sub_return_message: resData.sub_return_message,
  //     };
  //     return {
  //       status: 200,
  //       message: 'Check refund order status successfully',
  //       sub_message: 'Check refund order status successfully',
  //       detail: ResponseCheckRefundDto,
  //     };
  //   } catch (e) {
  //     throw e;
  //   }
  // }
}
