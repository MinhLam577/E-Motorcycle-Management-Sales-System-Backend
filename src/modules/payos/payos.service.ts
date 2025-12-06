import { BadRequestException, Injectable } from '@nestjs/common';
import PayOS from '@payos/node';
import { CreatePayOsOrderDto } from './dto/create-order-payos.dto';
import { UserValidationType } from 'src/auth/strategy/jwt.strategy';
import { Order } from '../order/entities/order.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { PaymentTransaction } from '../payment_transaction/entities/payment_transaction.entity';
import { EntityManager, In, Repository } from 'typeorm';
import CancelOrderPayosDto from './dto/cancel-order-payos.dto';
import ConfirmWebhookPayOsDto from './dto/confirm-webhook-payos.dto';
import {
  order_status,
  payment_method_name,
  payment_status,
  payment_status_label,
} from 'src/constants/order_status.enum';
import { Voucher } from '../vourchers/entities/vourcher.entity';
import { UserVourcher } from '../user_vourcher/entities/user_vourcher.entity';
import appConfig from 'src/config/app.config';

const return_success_url = `${appConfig().FE_URL_USER}/purchase`;
const cancel_url = `${appConfig().FE_URL_USER}/purchase`;
export interface ItemPayOsOrderDto {
  name: string; //Tên sản phẩm
  quantity: number; //Số lượng sản phẩm
  price: number; //Giá sản phẩm
}

export interface CreateOrderPayOsDto {
  orderCode: number; //Mã đơn hàng
  amount: number; // Số tiền thanh toán
  description: string; // Mô tả thanh toán, với tài khoản ngân hàng không phải liên kết qua payOS thì giới hạn ký tự là 9
  cancelUrl: string; // URL nhận dữ liệu khi người dùng chọn Huỷ đơn hàng.
  returnUrl: string; // URL nhận dữ liệu khi người dùng chọn Thanh toán thành công.
  signature?: string; // Chữ ký kiểm tra thông tin không bị thay đổi trong qua trình chuyển dữ liệu từ hệ thống của bạn sang payOS. Bạn cần dùng checksum key từ Kênh thanh toán và HMAC_SHA256 để tạo signature và data theo định dạng được sort theo alphabet: amount=$amount&cancelUrl=$cancelUrl&description=$description&orderCode=$orderCode&returnUrl=$returnUrl
  buyerName?: string; //Tên của người mua hàng. Thông tin dùng trong trường hợp tích hợp tạo hoá đơn điện tử.
  buyerEmail?: string; //Email của người mua hàng. Thông tin dùng trong trường hợp tích hợp tạo hoá đơn điện tử.
  buyerPhone?: string; //Số điện thoại người mua hàng. Thông tin dùng trong trường hợp tích hợp tạo hoá đơn điện tử.
  buyerAddress?: string; //Địa chỉ của người mua hàng. Thông tin dùng trong trường hợp tích hợp tạo hoá đơn điện tử.
  items?: ItemPayOsOrderDto[]; //Danh sách sản phẩm trong đơn hàng. Tối đa 20 sản phẩm.
  expiredAt?: number; // Thời gian hết hạn của link thanh toán, là Unix Timestamp và kiểu Int32
}

export interface WebhookData {
  orderCode: number; // Mã đơn hàng
  amount: number; // Số tiền thanh toán
  description: string; // Mô tả thanh toán
  accountNumber: string; // Số tài khoản của cửa hàng
  reference: string; // Mã tham chiếu giao dịch, dùng để tra soát với ngân hàng
  transactionDateTime: string; // Ngày giờ giao dịch thực hiện thành công
  currency: string; // Đơn vị tiền tệ của giao dịch, thường là VND
  code: string; // Mã lỗi của giao dịch
  desc: string; // Thông tin mô tả lỗi
  counterAccountBankId?: string; // Mã ngân hàng của tài khoản người mua
  counterAccountBankName?: string; // Tên ngân hàng của tài khoản người mua
  counterAccountName?: string; // Tên chủ tài khoản người mua
  counterAccountNumber?: string; // Số tài khoản của người mua
  virtualAccountName?: string; // Tên tài khoản ảo của cửa hàng
  virtualAccountNumber?: string; // Số tài khoản ảo của cửa hàng
}

export interface CancelPayosData {
  id: string; // Mã link thanh toán
  orderCode: number; // Mã đơn hàng
  amount: number; // Số tiền thanh toán
  amountPaid: number; // Số tiền đã thanh toán
  amountRemaining: number; // Số tiền còn lại
  status: string; // Trạng thái đơn hàng, có thể là 'CANCELLED', 'COMPLETED', v.v.
  createdAt: string; // Ngày giờ tạo đơn hàng
  transactions: any[]; // Danh sách giao dịch liên quan đến đơn hàng
  canceledAt: string; // Ngày giờ huỷ đơn hàng
  cancellationReason: string; // Lý do huỷ đơn hàng
}

export interface CreatePaymentData {
  bin?: string; // Mã định danh ngân hàng (thường gọi là BIN)
  accountNumber?: string; // Số tài khoản ngân hàng thụ hưởng, là số tài khoản ảo nếu Cổng thanh toán liên kết với VietQR PRO
  accountName?: string; // Tên tài khoản ngân hàng
  amount?: number; // Số tiền thanh toán
  description?: string; // Mô tả thanh toán
  orderCode?: number; // Mã đơn hàng
  currency?: string; // Đơn vị tiền tệ, thường là VND
  paymentLinkId?: string; // Mã link thanh toán duy nhất
  status?: string; // Trạng thái đơn hàng, có thể là 'PENDING', 'COMPLETED', v.v.
  expiredAt?: number; // Thời gian hết hạn của link thanh toán, là Unix Timestamp
  checkoutUrl?: string; // URL để người dùng vào trang thanh toán
  qrCode?: string; // Mã QR Code cho thanh toán (nếu có)
}

export interface WebhookPayOsResponse {
  code: string; // Mã lỗi
  desc: string; // Thông tin lỗi
  success: boolean; // Trạng thái thành công
  data: WebhookData;
  signature: string; // Chữ kí để kiểm tra thông tin
}

@Injectable()
export class PayosService {
  private payos: PayOS;
  constructor(
    @InjectRepository(PaymentTransaction)
    private readonly paymentTransactionRepository: Repository<PaymentTransaction>,

    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,

    @InjectRepository(Voucher)
    private readonly voucherRepository: Repository<Voucher>,
  ) {
    this.payos = new PayOS(
      process.env.PAYOS_CLIENT_ID,
      process.env.PAYOS_API_KEY,
      process.env.PAYOS_CHECKSUM_KEY,
    );
  }

  private async generateUniqueNumberWithFindAll(): Promise<number> {
    const existingOrderIds = await this.paymentTransactionRepository.find({
      select: ['payment_order_id'],
    });
    const usedIds = new Set(
      existingOrderIds.map((item) => item.payment_order_id),
    );

    let orderId: number;
    do {
      orderId = Math.floor(100000 + Math.random() * 900000); // Số 6 chữ số
    } while (usedIds.has(orderId));

    return orderId;
  }

  private generateSignature(createOrderDto: CreateOrderPayOsDto): string {
    const data = `amount=${createOrderDto.amount}&cancelUrl=${createOrderDto.cancelUrl}&description=${createOrderDto.description}&orderCode=${createOrderDto.orderCode}&returnUrl=${createOrderDto.returnUrl}`;
    return data;
  }

  private generateExpiredAt(minute?: number): number {
    const currentTime = new Date();
    const expirationTime = new Date(
      currentTime.getTime() + (minute || 30) * 60000, // Mặc định là 30 phút
    );
    return Math.floor(expirationTime.getTime() / 1000); // Trả về Unix Timestamp
  }

  async createOrderPayment(
    user: UserValidationType,
    createOrderPaymentDto: CreatePayOsOrderDto,
  ) {
    try {
      if (!user || !user.id) {
        throw new Error(
          'Token không hợp lệ, đã hết hạn hoặc user không tồn tại',
        );
      }
      const { orderId, voucherIds, description } = createOrderPaymentDto;
      return await this.paymentTransactionRepository.manager.transaction(
        async (manager: EntityManager) => {
          // Kiểm tra xem đơn hàng có tồn tại không
          const order = await manager.findOne(Order, {
            where: { id: orderId },
            relations: [
              'orderDetails',
              'paymentMethod',
              'orderDetails.skus',
              'paymentTransactions',
            ],
          });
          if (!order) {
            throw new BadRequestException(`Order #${orderId} không tồn tại`);
          }

          if (order.paymentTransactions.length > 0) {
            throw new BadRequestException(
              `Đơn hàng #${orderId} đã có giao dịch thanh toán trước đó`,
            );
          }

          if (
            !order.paymentMethod ||
            !order.paymentMethod.id ||
            order.paymentMethod.name !== payment_method_name.PAYOS
          ) {
            throw new BadRequestException(
              `Đơn hàng #${orderId} không có phương thức thanh toán hoặc phương thức thanh toán không hợp lệ`,
            );
          }

          // Kiểm tra trạng thái đơn hàng
          if (order.order_status !== order_status.PENDING) {
            throw new BadRequestException(
              `Đơn hàng #${orderId} đã được xử lý hoặc không hợp lệ`,
            );
          }

          const orderDetail: ItemPayOsOrderDto[] = order.orderDetails.map(
            (item) => ({
              name: item.skus.name,
              quantity: item.quantity,
              price: Number(item.skus.price_sold),
            }),
          );
          const orderCode = await this.generateUniqueNumberWithFindAll();
          const amount = Number(order.total_price);
          const defaultDescription = description || `Đơn hàng #${orderCode}`;
          const createOrderDto: CreateOrderPayOsDto = {
            orderCode,
            amount,
            cancelUrl: cancel_url,
            returnUrl: return_success_url,
            description: defaultDescription,
          };

          const signature = this.generateSignature(createOrderDto);
          if (signature) createOrderDto.signature = signature;
          if (user.email) {
            createOrderDto.buyerEmail = user.email;
          }
          if (user.username) {
            createOrderDto.buyerName = user.username;
          }
          if (user.phone) {
            createOrderDto.buyerPhone = user.phone;
          }
          if (orderDetail.length > 0) {
            createOrderDto.items = orderDetail;
          }
          const expiredAt = this.generateExpiredAt();
          createOrderDto.expiredAt = expiredAt;
          const response: CreatePaymentData =
            await this.payos.createPaymentLink(createOrderDto);
          if (!response || !response.checkoutUrl) {
            throw new BadRequestException(
              'Tạo đơn hàng bằng Payos thất bại, vui lòng thử lại sau',
            );
          }
          const {
            checkoutUrl,
            qrCode,
            status,
            description: des,
            expiredAt: timeExpired,
            orderCode: codeOrder,
            paymentLinkId,
            ...resData
          } = response;
          order.order_status = order_status.PENDING;
          order.payment_status = payment_status.PENDING;
          order.note = des;
          order.payment_url = checkoutUrl;
          order.payment_url_expired = new Date(timeExpired * 1000);

          await manager.save(order);
          const newPaymentTransaction = manager.create(PaymentTransaction, {
            payment_order_id: codeOrder,
            status: payment_status.PENDING,
            amount: amount,
            description: defaultDescription,
            order: order,
            payment_data: {
              ...resData,
            },
            transaction_id: paymentLinkId,
            paymentMethod: order.paymentMethod,
          });

          if (voucherIds) {
            const userVoucher = await manager.find(UserVourcher, {
              where: {
                customer: { id: user.id },
                voucher: { id: In(voucherIds) },
              },
              relations: ['voucher'],
            });
            if (userVoucher.length > 0) {
              const missingVouchers = voucherIds.filter(
                (id) => !userVoucher.some((uv) => uv.voucher.id === id),
              );
              if (missingVouchers.length > 0) {
                throw new BadRequestException(
                  `Bạn chưa sở hữu voucher với mã: ${missingVouchers.join(', ')}`,
                );
              }
              // Kiểm tra xem voucher đã được sử dụng hết chưa
              const usedVouchers = userVoucher.filter(
                (uv) =>
                  uv.voucher.status !== 'active' ||
                  uv.voucher.end_date < new Date() ||
                  uv.is_used === true,
              );
              if (usedVouchers.length > 0) {
                const usedVoucherIds = usedVouchers.map((uv) => uv.voucher.id);
                throw new BadRequestException(
                  `Các voucher với mã: ${usedVoucherIds.join(', ')} không còn hiệu lực, đã hết hạn hoặc đã sử dụng`,
                );
              }
            }
            const userVouchersMap = new Map(
              userVoucher.map((uv) => [uv.voucher.id, uv]),
            );
            const savedUserVouchers: UserVourcher[] = voucherIds.map(
              (voucherId) => {
                const userVoucher = userVouchersMap.get(voucherId);
                if (userVoucher) {
                  userVoucher.is_used = true;
                  userVoucher.used_at = new Date();
                  userVoucher.voucher.uses += 1;
                  return userVoucher;
                }
              },
            );
            await manager.save(savedUserVouchers);
          }
          await manager.save(newPaymentTransaction);

          return {
            status: 200,
            message: 'Tạo link thanh toán thành công',
            data: {
              order_id: order.id,
              payment_order_id: newPaymentTransaction.payment_order_id,
              transaction_id: newPaymentTransaction.transaction_id,
              order_details: orderDetail,
              total_amount: order.total_price,
              discount_amount: order.discount_price || 0,
              description: defaultDescription,
              checkoutUrl: checkoutUrl,
              qrCode: qrCode,
            },
          };
        },
      );
    } catch (error) {
      console.error('Lỗi khi tạo order payos: ', error);
      throw error;
    }
  }

  async cancelOrderPayment(
    user: UserValidationType,
    id: string,
    body: CancelOrderPayosDto,
  ) {
    try {
      if (!user || !user.id) {
        throw new Error(
          'Token không hợp lệ, đã hết hạn hoặc user không tồn tại',
        );
      }
      const response: CancelPayosData = await this.payos.cancelPaymentLink(
        id,
        body.cancellationReason || '',
      );

      const { orderCode, cancellationReason } = response;
      return await this.paymentTransactionRepository.manager.transaction(
        async (manager: EntityManager) => {
          const paymentTransaction = await manager.findOne(PaymentTransaction, {
            where: { payment_order_id: orderCode },
            relations: ['order'],
          });
          if (!paymentTransaction) {
            throw new BadRequestException(
              `Không tìm thấy giao dịch thanh toán với mã đơn hàng ${orderCode}`,
            );
          }
          const order = paymentTransaction.order;
          order.order_status = order_status.CANCELLED;
          order.payment_status = payment_status.CANCELLED;
          order.note = cancellationReason || `Đơn hàng #${order.id} đã bị huỷ`;

          paymentTransaction.status = payment_status.CANCELLED;

          await Promise.all([
            manager.save(order),
            manager.save(paymentTransaction),
          ]);
          return {
            status: 200,
            message: `Đơn hàng #${order.id} đã được huỷ thành công`,
            data: {
              order_id: order.id,
              cancelData: response,
            },
          };
        },
      );
    } catch (error) {
      console.error('Error canceling PayOS order:', error);
      throw error;
    }
  }

  async confirmWebhook(body: ConfirmWebhookPayOsDto) {
    try {
      const { webhookUrl } = body;
      const response = await this.payos.confirmWebhook(webhookUrl);
      return {
        status: 200,
        message: 'Xác thức, thêm hoặc cật nhật webhook thành công',
        data: response,
      };
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if (typeof error.code === 'string') {
          const errorCode = error.code.toLowerCase();
          if (errorCode === '20') {
            throw new BadRequestException(
              'Webhook URL không hợp lệ, không tìm thấy hoặc không có quyền truy cập',
            );
          } else {
            throw new BadRequestException(
              'Lỗi xác thực, thiếu x-client-id hoặc x-api-key trong header',
            );
          }
        }
      }
      throw error;
    }
  }

  async handleWebhook(req: any) {
    try {
      if (!req || !req.body || JSON.stringify(req.body) === '{}') {
        throw new BadRequestException(
          'Yêu cầu không hợp lệ, không có dữ liệu webhook',
        );
      }

      const webhookData: WebhookPayOsResponse = req.body;

      const { data } = webhookData;
      const { orderCode } = data;

      const paymentTransaction =
        await this.paymentTransactionRepository.findOne({
          where: { payment_order_id: orderCode },
          relations: ['order'],
        });

      if (!paymentTransaction) {
        throw new BadRequestException(
          `Không tìm thấy giao dịch thanh toán với mã đơn hàng ${orderCode}`,
        );
      }

      const order = paymentTransaction.order;

      if (paymentTransaction.status === payment_status.PAID) {
        return {
          message: `Đơn hàng #${order.id} đã được thanh toán trước đó`,
          data: { order_id: order.id, payment_order_id: orderCode },
        };
      }

      if (webhookData.success) {
        order.payment_status = payment_status.PAID;
        const paymentTime = new Date(data.transactionDateTime);
        if (isNaN(paymentTime.getTime())) {
          throw new BadRequestException('Ngày giao dịch không hợp lệ');
        }
        order.payment_time = paymentTime;
        order.note =
          data.desc || `Đơn hàng #${order.id} đã thanh toán thành công`;

        await this.orderRepository.manager.transaction(async (manager) => {
          await manager.save(Order, order);
          paymentTransaction.status = payment_status.PAID;
          await manager.save(PaymentTransaction, paymentTransaction);
        });

        return {
          message: `Đơn hàng #${order.id} đã thanh toán thành công`,
          data: {
            order_id: order.id,
            payment_order_id: paymentTransaction.payment_order_id,
          },
        };
      } else {
        order.payment_status = payment_status.FAILED;
        order.order_status = order_status.CANCELLED;
        paymentTransaction.status = payment_status.FAILED;
        order.note =
          webhookData.desc || `Đơn hàng #${order.id} thanh toán thất bại`;
        await this.orderRepository.manager.transaction(async (manager) => {
          await manager.save(Order, order);
          await manager.save(PaymentTransaction, paymentTransaction);
        });
      }
    } catch (error) {
      console.error('Error handling PayOS webhook:', error);
      throw error;
    }
  }

  // Hàm tiện ích để định dạng dữ liệu trả về
  private formatResponseData(order: Order, order_payment: PaymentTransaction) {
    return {
      order_id: order.id,
      payment_order_id: order_payment.payment_order_id,
      payment_status: payment_status_label[order.payment_status],
      note: order.note,
      payment_time: order.payment_time,
      payment_url: order.payment_url,
      payment_url_expired: order.payment_url_expired,
    };
  }

  async CheckPayosPaymentStatus(user: UserValidationType, orderId: number) {
    try {
      if (!user || !user.id) {
        throw new BadRequestException(
          'Token không hợp lệ, đã hết hạn hoặc user không tồn tại',
        );
      }

      const order_payment = await this.paymentTransactionRepository.findOne({
        where: { payment_order_id: orderId },
        relations: ['order'],
      });

      if (!order_payment || !order_payment.order) {
        throw new BadRequestException(
          `Không tìm thấy đơn hàng với ID ${orderId}`,
        );
      }

      let response;
      try {
        response = await this.payos.getPaymentLinkInformation(orderId);
      } catch (apiError) {
        console.error(
          `Error calling PayOS API for order ${orderId}:`,
          apiError,
        );
        throw new BadRequestException(
          'Không thể lấy thông tin thanh toán từ PayOS',
        );
      }

      const order = order_payment.order;
      if (order.payment_status === payment_status.PAID) {
        return {
          status: 200,
          message: `Đơn hàng #${order.id} đã thanh toán thành công`,
          data: this.formatResponseData(order, order_payment),
        };
      } else if (
        order.payment_status === payment_status.CANCELLED ||
        order.payment_status === payment_status.FAILED ||
        order.order_status === order_status.CANCELLED
      ) {
        return {
          status: 200,
          message: `Đơn hàng #${order.id} đã bị huỷ hoặc thanh toán thất bại`,
          data: this.formatResponseData(order, order_payment),
        };
      } else if (order.payment_status === payment_status.EXPIRED) {
        return {
          status: 200,
          message: `Đơn hàng #${order.id} đã hết hạn thanh toán`,
          data: this.formatResponseData(order, order_payment),
        };
      }

      const status = response.status.toUpperCase();
      const paymentStatus =
        payment_status[status as keyof typeof payment_status];

      // Chỉ cập nhật nếu trạng thái thay đổi
      let isUpdated = false;
      switch (paymentStatus) {
        case payment_status.PAID:
          order.payment_status = payment_status.PAID;
          order.order_status = order_status.PENDING;
          order.note =
            order.note || `Đơn hàng #${order.id} đã thanh toán thành công`;
          order.payment_time = new Date();
          isUpdated = true;
          break;
        case payment_status.EXPIRED:
          order.payment_status = payment_status.EXPIRED;
          order.order_status = order_status.CANCELLED;
          order.note =
            order.note || `Đơn hàng #${order.id} đã hết hạn thanh toán`;
          order.payment_url_expired = new Date();
          order_payment.status = payment_status.EXPIRED;
          isUpdated = true;
          break;
        case payment_status.CANCELLED:
          order.payment_status = payment_status.CANCELLED;
          order.order_status = order_status.CANCELLED;
          order.note =
            order.note || `Đơn hàng #${order.id} đã bị huỷ thanh toán`;
          order_payment.status = payment_status.CANCELLED;
          isUpdated = true;
          break;
        case payment_status.FAILED:
          order.payment_status = payment_status.FAILED;
          order.order_status = order_status.CANCELLED;
          order.note =
            order.note || `Đơn hàng #${order.id} thanh toán thất bại`;
          order_payment.status = payment_status.FAILED;
          isUpdated = true;
          break;
        case payment_status.PROCESSING:
        case payment_status.PENDING:
          if (order.payment_status !== payment_status.PENDING) {
            order.payment_status = payment_status.PENDING;
            order.order_status = order_status.PENDING;
            order.note =
              order.note || `Đơn hàng #${order.id} đang chờ thanh toán`;
            order_payment.status = payment_status.PENDING;
            isUpdated = true;
          }
          break;
      }

      // Lưu thay đổi nếu có
      if (isUpdated) {
        await this.orderRepository.manager.transaction(async (manager) => {
          await manager.save(Order, order);
          await manager.save(PaymentTransaction, order_payment);
        });
      }

      return {
        status: 200,
        message: `Trạng thái thanh toán của đơn hàng #${order.id} đã được cập nhật`,
        data: this.formatResponseData(order, order_payment),
      };
    } catch (error) {
      console.error('Error getting order payment information:', error);
      throw error;
    }
  }
}
