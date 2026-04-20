import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateOrderDto, order_detail_dto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { EntityManager, FindOptionsWhere, In, Raw, Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { ReceiveAddressEntity } from '../receive_address/entities/receive_address.entity';
import { PaymentMethod } from '../payment_method/entities/payment_method.entity';
import { DeliveryMethod } from '../delivery_method/entities/delivery_method.entity';
import { ResponseOrderDto } from './dto/response-order.dto';
import { getRelations, transformDto } from 'src/helpers/transformObjectDto';
import {
  OrderPaginationQueryDto,
  orderSortBy,
} from './dto/order-pagination-query.dto';
import {
  order_status,
  order_status_label,
  payment_method_name,
  payment_status,
} from 'src/constants/order_status.enum';
import { OrderDetail } from '../order_detail/entities/order_detail.entity';
import { Skus } from '../skus/entities/skus.entity';
import { ExportService } from '../export/export.service';
import {
  ZaloOrderStatus,
  ZaloPay_query_url,
  ZaloPayConfig,
  ZaloPaySaveDatabaseKey,
} from '../zalo-payment/zalo-payment.service';
import { DetailImportService } from '../detail_import/detail_import.service';
import { convertToTimeStampPostgres } from 'src/helpers/datetime.format';
import { SortOrder } from 'src/constants/sortOrder.enum';
import { isUUID } from 'class-validator';
import { CreateOrderDtoFromCart } from './dto/create-order-from-cart.dto';
import { CartItem } from '../cart_item/entities/cart_item.entity';
import dayjs from 'dayjs';
import { generateMac } from 'src/helpers/utils';
import axios from 'axios';
import { API_Header_Content_Type_Format } from 'src/constants';
import { OrderPaymentMethodOption } from '../order_payment_method_option/entities/order_payment_method_option.entity';
import { ZaloPayCheckOrderStatus } from 'src/constants/zalo-payment.enum';
import { PaymentMethodOption } from '../payment_method_option/entities/payment_method_option.entity';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PayosService } from '../payos/payos.service';
import { UserValidationType } from 'src/auth/strategy/jwt.strategy';
import { RoleEnum } from 'src/constants/role.enum';

export const getMonthsInRange = (
  start_date: string,
  end_date: string,
): { year: number; month: number }[] => {
  const start = dayjs(start_date).startOf('month');
  const end = dayjs(end_date).startOf('month');
  const months: { year: number; month: number }[] = [];

  let current = start;
  while (current.isBefore(end) || current.isSame(end, 'month')) {
    months.push({
      year: current.year(),
      month: current.month() + 1, // Tháng trong dayjs từ 0-11, cộng 1 để thành 1-12
    });
    current = current.add(1, 'month');
  }

  return months;
};
interface EntityWithId {
  id: string; // Hoặc kiểu khác như number, tùy thuộc vào ứng dụng của bạn
}
@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly exportService: ExportService,
    private readonly detail_import_service: DetailImportService,

    @InjectRepository(PaymentMethodOption)
    private readonly paymentMethodOptionRepository: Repository<PaymentMethodOption>,
    private readonly payosService: PayosService,
  ) {}

  private async validateDto(
    createOrderDto: CreateOrderDto,
    manager?: EntityManager,
  ) {
    const {
      customer_id,
      receive_address_id,
      payment_method_id,
      delivery_method_id,
      order_details,
    } = createOrderDto;
    let skus_ids = order_details.map((order_detail) => order_detail.skus_id);
    this.checkDuplicateSkusId(order_details);
    const customer = await manager
      .createQueryBuilder(Customer, 'customer')
      .where('customer.id = :customer_id', { customer_id })
      .select('customer')
      .getOne();
    if (!customer) {
      throw new NotFoundException(`Customer not found`);
    }
    const receiveAddress = await manager.findOne(ReceiveAddressEntity, {
      where: {
        id: receive_address_id,
      },
    });
    if (!receiveAddress) {
      throw new NotFoundException(`Receive address not found`);
    }

    const paymentMethod = await manager.findOne(PaymentMethod, {
      where: {
        id: payment_method_id,
      },
    });
    if (!paymentMethod) {
      throw new NotFoundException(`Payment method not found`);
    }

    const deliveryMethod = await manager.findOne(DeliveryMethod, {
      where: {
        id: delivery_method_id,
      },
    });
    if (!deliveryMethod) {
      throw new NotFoundException(`Delivery method not found`);
    }
    return {
      customer,
      receiveAddress,
      paymentMethod,
      deliveryMethod,
      skus_ids,
    };
  }
  async createOrder(createOrderDto: CreateOrderDto): Promise<{
    status: number;
    message: string;
    data: ResponseOrderDto;
  }> {
    try {
      return await this.orderRepository.manager.transaction(async (manager) => {
        const { order_details } = createOrderDto;
        const {
          customer,
          receiveAddress,
          paymentMethod,
          deliveryMethod,
          skus_ids,
        } = await this.validateDto(createOrderDto, manager);
        const skusList = await manager.find(Skus, {
          where: {
            id: In(skus_ids),
          },
          relations: ['product', 'detail_import'],
        });

        if (skusList.length !== skus_ids.length) {
          const notFoundSkus = skus_ids.filter(
            (s) => !skusList.find((skus) => skus.id === s),
          );
          throw new NotFoundException(
            `Skus #${notFoundSkus.join(', ')} not found`,
          );
        }

        const order = manager.create(Order, {
          ...createOrderDto,
          customer,
          receiveAddress,
          paymentMethod,
          deliveryMethod,
        });
        const resOrder = await manager.save(Order, order);

        // Create map of skus for optimize search skus by id
        const skusMap = new Map(skusList.map((skus) => [skus.id, skus]));
        const orderDetails = await Promise.all(
          order_details.map(async (order_details) => {
            const skus = skusMap.get(order_details.skus_id);
            if (!skus.detail_import || skus.detail_import.length === 0) {
              throw new NotFoundException(
                `Skus #${order_details.skus_id} has no detail import`,
              );
            }
            const remaining_quantity = skus.detail_import.reduce(
              (total, current) => total + current.quantity_remaining,
              0,
            );

            if (remaining_quantity < order_details.quantity) {
              throw new BadRequestException(
                `Quantity needed ${order_details.quantity} is greater than quantity remaining ${remaining_quantity} of skus #${skus.id}`,
              );
            }

            return manager.create(OrderDetail, {
              skus: skus,
              quantity: order_details.quantity,
              order: resOrder,
            });
          }),
        );

        const saveOrderDetails = await manager.save(OrderDetail, orderDetails);
        resOrder.orderDetails = saveOrderDetails;
        return {
          status: 201,
          message: 'Order has been successfully created',
          data: transformDto(ResponseOrderDto, resOrder),
        };
      });
    } catch (e) {
      throw e;
    }
  }

  async createOrderFromCartItem(
    createOrderDtoFromCart: CreateOrderDtoFromCart,
  ) {
    try {
      return await this.orderRepository.manager.transaction(async (manager) => {
        const { cart_item_ids, ...restCreateOrder } = createOrderDtoFromCart;

        const cartItems = await manager.find(CartItem, {
          where: {
            id: In(cart_item_ids),
          },
          relations: ['skus', 'skus.product'],
        });
        if (cartItems.length !== cart_item_ids.length) {
          const notFoundCartItems = cart_item_ids.filter(
            (s) => !cartItems.find((cartItem) => cartItem.id === s),
          );
          throw new NotFoundException(
            `Cart items #${notFoundCartItems.join(', ')} not found`,
          );
        }

        const order_details = cartItems.map((cartItem) => ({
          skus_id: cartItem.skus.id,
          quantity: cartItem.quantity,
        }));

        if (order_details.length === 0) {
          throw new BadRequestException(`Order details is empty`);
        }

        const createOrderDto: CreateOrderDto = {
          ...restCreateOrder,
          order_details,
        };

        const {
          customer,
          receiveAddress,
          paymentMethod,
          deliveryMethod,
          skus_ids,
        } = await this.validateDto(createOrderDto, manager);
        const skusList = await manager.find(Skus, {
          where: {
            id: In(skus_ids),
          },
          relations: ['product', 'detail_import'],
        });

        if (skusList.length !== skus_ids.length) {
          const notFoundSkus = skus_ids.filter(
            (s) => !skusList.find((skus) => skus.id === s),
          );
          throw new NotFoundException(
            `Skus #${notFoundSkus.join(', ')} not found`,
          );
        }

        const order = manager.create(Order, {
          ...createOrderDto,
          customer,
          receiveAddress,
          paymentMethod,
          deliveryMethod,
        });
        const resOrder = await manager.save(Order, order);

        const skusMap = new Map(skusList.map((skus) => [skus.id, skus]));
        const orderDetails = await Promise.all(
          order_details.map(async (order_details) => {
            const skus = skusMap.get(order_details.skus_id);
            if (!skus.detail_import || skus.detail_import.length === 0) {
              throw new NotFoundException(
                `Skus #${order_details.skus_id} has no detail import`,
              );
            }
            const remaining_quantity = skus.detail_import.reduce(
              (total, current) => total + current.quantity_remaining,
              0,
            );

            if (remaining_quantity < order_details.quantity) {
              throw new BadRequestException(
                `Quantity needed ${order_details.quantity} is greater than quantity remaining ${remaining_quantity} of skus #${skus.id}`,
              );
            }

            return manager.create(OrderDetail, {
              skus: skus,
              quantity: order_details.quantity,
              order: resOrder,
            });
          }),
        );

        const saveOrderDetails = await manager.save(OrderDetail, orderDetails);
        resOrder.orderDetails = saveOrderDetails;

        // Xóa cart item đã được sử dụng
        await manager.remove(CartItem, cartItems);
        return {
          status: 201,
          message: 'Order has been successfully created',
          data: transformDto(ResponseOrderDto, resOrder),
        };
      });
    } catch (e) {
      console.error('Create order from cart failed: ', e);
      throw e;
    }
  }

  async findAll(query: OrderPaginationQueryDto) {
    try {
      const {
        current = 1,
        pageSize = 20,
        sortOrder = SortOrder.DESC,
        sortBy = orderSortBy.UPDATED_AT,
        ...filter
      } = query;
      const start = (current - 1) * pageSize;
      const queryBuilder = this.orderRepository
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.customer', 'customer')
        .leftJoinAndSelect('order.receiveAddress', 'receiveAddress')
        .leftJoinAndSelect('order.paymentMethod', 'paymentMethod')
        .leftJoinAndSelect('order.deliveryMethod', 'deliveryMethod')
        .leftJoinAndSelect('order.orderDetails', 'orderDetails')
        .leftJoinAndSelect('orderDetails.skus', 'skus')
        .leftJoinAndSelect('skus.product', 'products');
      if (filter.search && filter.search.trim() !== '') {
        const conditions: string[] = [];
        const params: Record<string, any> = {
          search: `%${filter.search.trim()}%`,
        };

        if (isUUID(filter.search)) {
          conditions.push('order.id = :searchExact');
          conditions.push('customer.id = :searchExact');
          params.searchExact = filter.search;
        }

        conditions.push('customer.username ILIKE :search');
        conditions.push('customer.email ILIKE :search');

        queryBuilder.andWhere(`(${conditions.join(' OR ')})`, params);
      }
      if (filter.order_status !== null && filter.order_status !== undefined) {
        queryBuilder.andWhere('order.order_status = :order_status', {
          order_status: filter.order_status,
        });
      }
      if (filter.payment_status) {
        queryBuilder.andWhere('order.payment_status = :payment_status', {
          payment_status: filter.payment_status,
        });
      }
      if (filter.payment_method) {
        queryBuilder.andWhere('paymentMethod.name = :payment_method', {
          payment_method: filter.payment_method,
        });
      }

      if (filter.created_from && filter.created_to) {
        const from = convertToTimeStampPostgres(filter.created_from);
        const to = convertToTimeStampPostgres(filter.created_to);
        if (from <= to) {
          queryBuilder.andWhere('order.createdAt BETWEEN :from AND :to', {
            from,
            to,
          });
        } else {
          throw new BadRequestException(
            'created_from must be less than or equal to created_to',
          );
        }
      }
      if (filter.delivery_method) {
        queryBuilder.andWhere('deliveryMethod.id = :delivery_method', {
          delivery_method: filter.delivery_method,
        });
      }
      const [orders, total] = await queryBuilder
        .orderBy(
          `order.${sortBy ? sortBy : orderSortBy.UPDATED_AT}`,
          sortOrder === SortOrder.ASC ? 'ASC' : 'DESC',
        )
        .skip(start)
        .take(pageSize)
        .getManyAndCount();
      const total_page = Math.ceil(total / pageSize);
      const resOrders = orders.map((order) =>
        transformDto(ResponseOrderDto, order),
      );
      return {
        orders: resOrders,
        meta: {
          total: total,
          totalPage: total_page,
          pageSize,
          current,
        },
      };
    } catch (e) {
      throw e;
    }
  }

  getAllOrderStatus() {
    try {
      const orderStatus = Object.values(order_status)
        .filter((o) => isNaN(Number(o)))
        .map((key) => ({
          key,
          value: order_status[key],
        }));
      return {
        status: 200,
        message: 'Order status has been successfully retrieved',
        data: orderStatus,
      };
    } catch (e) {
      throw e;
    }
  }

  getAllPaymentStatus() {
    try {
      const paymentStatus = Object.values(payment_status)
        .filter((o) => isNaN(Number(o)))
        .map((key) => ({
          key,
          value: payment_status[key],
        }));
      return {
        status: 200,
        message: 'Payment status has been successfully retrieved',
        data: paymentStatus,
      };
    } catch (e) {
      throw e;
    }
  }

  async findOne(
    id: string,
    isResponseDto: boolean = true,
    relations: string[] = [],
  ): Promise<{
    status: number;
    message: string;
    data: ResponseOrderDto | Order;
  }> {
    try {
      relations =
        relations.length > 0 ? relations : getRelations(this.orderRepository);
      const order = await this.orderRepository.findOne({
        where: {
          id,
        },
        relations: [
          ...relations,
          'orderDetails',
          'orderDetails.skus',
          'orderDetails.skus.detail_import',
          'orderDetails.skus.detail_import.warehouse',
          'orderDetails.skus.product',
        ],
      });
      if (!order) {
        throw new NotFoundException(`Not found any order with the given id`);
      }
      let result = {
        status: 200,
        message: 'Order has been successfully retrieved',
        data: null,
      };
      if (isResponseDto) {
        const res: any = transformDto(ResponseOrderDto, order);
        const totalRemainingPerSku = res.order_details.reduce((acc, cur) => {
          const skusId = cur.skus.id;
          if (!acc[skusId]) {
            acc[skusId] = 0;
          }
          acc[skusId] += cur.skus.detail_import.reduce(
            (total, current) => total + current.quantity_remaining,
            0,
          );
          return acc;
        }, {});

        res.order_details.forEach((orderDetail) => {
          const skusId = orderDetail.skus.id;
          orderDetail.skus.total_remaining = totalRemainingPerSku[skusId] || 0;
        });
        result.data = res;
      } else {
        result.data = order;
      }
      return result;
    } catch (e) {
      throw e;
    }
  }

  async getOrderByCustomerId(
    customer_id: string,
    pq: OrderPaginationQueryDto,
  ): Promise<{
    status: number;
    message: string;
    data: {
      totalRecord: number;
      pageSize: number;
      totalPage: number;
      current: number;
      orders: ResponseOrderDto[];
    };
  }> {
    try {
      const { current = 1, pageSize = 1000, sortOrder, sortBy } = pq;
      const start = (current - 1) * pageSize;
      const [orders, totalRecord] = await this.orderRepository.findAndCount({
        where: {
          customer: {
            id: customer_id,
          },
        },
        relations: [
          'customer',
          'receiveAddress',
          'paymentMethod',
          'deliveryMethod',
        ],
        order: {
          [sortBy]: sortOrder,
        },
        skip: start,
        take: pageSize,
      });

      if (!orders || orders.length === 0) {
        throw new NotFoundException(
          `Not found any order with the given customer id`,
        );
      }

      const total_page = Math.ceil(totalRecord / pageSize);

      const resOrders = orders.map((order) =>
        transformDto(ResponseOrderDto, order),
      );
      return {
        status: 200,
        message: 'Order has been successfully retrieved',
        data: {
          totalRecord,
          totalPage: total_page,
          pageSize,
          current,
          orders: resOrders,
        },
      };
    } catch (e) {
      throw e;
    }
  }

  private checkStatusUpdate(
    status: number,
    updateOrderDto: UpdateOrderDto,
    order: Order,
  ) {
    const {
      customer_id,
      receive_address_id,
      payment_method_id,
      delivery_method_id,
      order_details,
    } = updateOrderDto;
    switch (status) {
      case order_status.PENDING:
        break;
      case order_status.CONFIRMED:
        if (payment_method_id !== order.paymentMethod.id) {
          throw new Error('Cannot change payment method for confirmed order');
        }
        break;
      case order_status.EXPORTED:
      case order_status.DELIVERING:
      case order_status.SHIPPING:
        if (
          payment_method_id !== order.paymentMethod.id ||
          delivery_method_id !== order.deliveryMethod.id ||
          receive_address_id !== order.receiveAddress.id
        ) {
          throw new BadRequestException(
            'Cannot change payment method or delivery method or receive address for exported order',
          );
        }
        break;
      case order_status.DELIVERED:
      case order_status.CANCELLED:
        throw new BadRequestException(
          'Cannot update order with status delivered or cancelled',
        );
    }
  }

  private checkDuplicateSkusId(order_details: order_detail_dto[]) {
    let skus_ids = order_details.map(
      (order_detail: order_detail_dto) => order_detail.skus_id,
    );

    let countSkusID = {};

    skus_ids.forEach((skus_id) => {
      countSkusID[skus_id] = (countSkusID[skus_id] || 0) + 1;
    });

    const duplicateSkusId = Object.keys(countSkusID).filter(
      (k) => countSkusID[k] > 1,
    );

    if (duplicateSkusId.length > 0) {
      throw new BadRequestException(
        `Duplicate skus id #${duplicateSkusId.join(', ')}`,
      );
    }
  }

  // Hàm tái sử dụng để cập nhật thực thể liên quan
  async checkExistedEntity<T extends EntityWithId>(
    manager: EntityManager,
    entityClass: new () => T,
    entityId: string,
    currentEntity: T,
    entityName: string,
  ): Promise<T> {
    if (entityId && entityId !== currentEntity.id) {
      const entity = await manager.findOne(entityClass, {
        where: { id: entityId } as FindOptionsWhere<T>,
      });
      if (!entity) {
        throw new NotFoundException(`${entityName} not found`);
      }
      return entity;
    }
    return currentEntity;
  }
  async update(
    id: string,
    updateOrderDto: UpdateOrderDto,
  ): Promise<{
    status: number;
    message: string;
    data: ResponseOrderDto;
  }> {
    try {
      this.checkDuplicateSkusId(updateOrderDto.order_details);
      const skus_ids = updateOrderDto.order_details.map(
        (order_detail) => order_detail.skus_id,
      );
      return await this.orderRepository.manager.transaction(async (manager) => {
        const order = await manager.findOne(Order, {
          where: {
            id,
          },
          relations: [
            'customer',
            'receiveAddress',
            'paymentMethod',
            'deliveryMethod',
            'orderDetails',
            'orderDetails.skus',
            'orderDetails.skus.product',
          ],
        });
        if (!order) {
          throw new NotFoundException(`Not found any order with the given id`);
        }

        const status = order.order_status;
        const {
          customer_id,
          receive_address_id,
          payment_method_id,
          delivery_method_id,
        } = updateOrderDto;

        this.checkStatusUpdate(status, updateOrderDto, order);

        order.customer = await this.checkExistedEntity(
          manager,
          Customer,
          customer_id,
          order.customer,
          'Customer',
        );

        order.receiveAddress = await this.checkExistedEntity(
          manager,
          ReceiveAddressEntity,
          receive_address_id,
          order.receiveAddress,
          'Receive address',
        );

        order.paymentMethod = await this.checkExistedEntity(
          manager,
          PaymentMethod,
          payment_method_id,
          order.paymentMethod,
          'Payment method',
        );

        order.deliveryMethod = await this.checkExistedEntity(
          manager,
          DeliveryMethod,
          delivery_method_id,
          order.deliveryMethod,
          'Delivery method',
        );

        // Get list of skus
        const skusList = await manager.find(Skus, {
          where: {
            id: In(skus_ids),
          },
          relations: ['product'],
        });

        // Create map of skus for optimize search skus by id
        const skusMap = new Map(skusList.map((skus) => [skus.id, skus]));

        if (skusList.length !== skus_ids.length) {
          const notFoundSkus = skus_ids.filter(
            (s) => !skusList.find((skus) => skus.id === s),
          );
          throw new NotFoundException(
            `Skus with id ${notFoundSkus.join(', ')} not found`,
          );
        }

        // Get list of existed order details
        const existOrderDetails = order.orderDetails;

        // Create map of order details for optimize search order details by sku id
        const orderDetailsMap = new Map(
          existOrderDetails.map((orderDetail) => [
            orderDetail.skus.id,
            orderDetail,
          ]),
        );

        const newOrderDetails = updateOrderDto.order_details;

        const updateOrderDetails = await Promise.all(
          newOrderDetails.map(async (order_detail) => {
            // Get skus by id
            const skus = skusMap.get(order_detail.skus_id);

            // Get existed order detail by skus id
            const existed_Skus_OrderDetail = orderDetailsMap.get(skus.id);

            // check quantity remaining
            const remaining_quantity = skus.detail_import.reduce(
              (total, current) => total + current.quantity_remaining,
              0,
            );

            if (remaining_quantity < order_detail.quantity) {
              throw new BadRequestException(
                `Quantity needed ${order_detail.quantity} is greater than quantity remaining ${remaining_quantity} of skus ${skus.id}`,
              );
            }

            // If existed order detail then update quantity
            if (existed_Skus_OrderDetail) {
              if (!skus.detail_import || skus.detail_import.length === 0) {
                throw new NotFoundException(
                  `Skus #${order_detail.skus_id} has no detail import`,
                );
              }

              existed_Skus_OrderDetail.quantity = order_detail.quantity;
              // Remove handled order detail from map
              orderDetailsMap.delete(skus.id);
              return existed_Skus_OrderDetail;
            }

            // If not existed order detail then create new order detail
            return manager.create(OrderDetail, {
              skus: skus,
              quantity: order_detail.quantity,
              order: order,
            });
          }),
        );
        order.orderDetails = await manager.save(
          OrderDetail,
          updateOrderDetails,
        );
        // Delete order details which not exist in new order details
        // Convert list of skus id to set for optimize search
        const skusIdsSet = new Set(skus_ids);
        const deleteOrderDetails = existOrderDetails.filter(
          (orderDetail) => !skusIdsSet.has(orderDetail.skus.id),
        );

        await manager.remove(OrderDetail, deleteOrderDetails);

        const { order_details, ...updateOrderDtoWithoutOrderDetails } =
          updateOrderDto;
        const updatedOrder = await manager.save(Order, {
          ...order,
          ...updateOrderDtoWithoutOrderDetails,
        });
        return {
          status: 200,
          message: 'Order has been successfully updated',
          data: transformDto(ResponseOrderDto, updatedOrder),
        };
      });
    } catch (e) {
      throw e;
    }
  }

  async remove(id: string): Promise<{
    status: number;
    message: string;
  }> {
    try {
      const order = await this.orderRepository.findOne({
        where: {
          id,
        },
      });
      if (!order) {
        throw new NotFoundException(`Not found any order with the given id`);
      }
      await this.orderRepository.delete(id);
      return {
        status: 200,
        message: 'Order has been successfully deleted',
      };
    } catch (e) {
      throw e;
    }
  }

  private validateOrderStatus(order?: Order) {
    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng với id đã cho`);
    }
  }

  private handleCancelOrder(order: Order) {
    const nonCancelStatus = [
      order_status.EXPORTED,
      order_status.DELIVERING,
      order_status.SHIPPING,
      order_status.DELIVERED,
      order_status.CANCELLED,
      order_status.FAILED_DELIVERY,
    ];
    if (nonCancelStatus.includes(order.order_status)) {
      throw new BadRequestException(
        `Đơn hàng ${order_status_label[order.order_status]?.toLowerCase()}, không thể hủy`,
      );
    }
  }

  private async updateNormalOrderStatusLogic(
    user: any,
    order: Order,
    paymentName: string,
    isFailedDelivery = false,
    baseManager?: EntityManager,
  ) {
    const current_order_status = order.order_status;
    const order_payment_status = order.payment_status;

    const completed_order_status = [order_status.CANCELLED];
    // Kiểm tra trạng thái không thể cật nhật trạng thái đơn hàng vì quy trình đã hoàn tất
    if (completed_order_status.includes(current_order_status)) {
      throw new BadRequestException(
        `Đơn hàng ${order_status_label[current_order_status]?.toLowerCase()}, không thể cập nhật trạng thái`,
      );
    }

    if (current_order_status === order_status.PENDING) {
      throw new BadRequestException(
        `Vui lòng gọi confirmOrder API cho đơn hàng ${order_status_label[current_order_status]?.toLowerCase()}`,
      );
    }

    // const allow_update_to_return_status = [
    //   order_status.DELIVERED,
    //   order_status.FAILED_DELIVERY,
    // ];
    // if (allow_update_to_return_status.includes(current_order_status)) {
    //   throw new BadRequestException(
    //     `Call returnOrder API to handle DELIVERED or FAILED_DELIVERY order`,
    //   );
    // }

    // Kiểm tra cập nhật sang FAILED_DELIVERY
    if (
      current_order_status !== order_status.SHIPPING &&
      current_order_status !== order_status.DELIVERING &&
      isFailedDelivery
    ) {
      throw new BadRequestException(
        `Đơn hàng ${order_status_label[current_order_status]?.toLowerCase()} không thể cập nhật sang trạng thái ${order_status_label[order_status.FAILED_DELIVERY]?.toLowerCase()} (phải là ${order_status_label[order_status.DELIVERING]?.toLowerCase()} hoặc ${order_status_label[order_status.SHIPPING]?.toLowerCase()})`,
      );
    }

    // Kiểm tra thanh toán pending
    if (order_payment_status === payment_status.PENDING) {
      if (paymentName !== payment_method_name.COD)
        throw new BadRequestException(
          `Đơn hàng chưa thanh toán, vui lòng thanh toán trước khi cập nhật trạng thái`,
        );
    }

    // Kiểm tra thanh toán thất bại
    if (order_payment_status === payment_status.FAILED) {
      if (paymentName !== payment_method_name.COD) {
        await this.cancelOrder(order.id, user, 'Payment failed', baseManager);
      } else {
        order.order_status = order_status.FAILED_DELIVERY;
      }
      return;
    }

    // // Kiểm tra thanh toán hoàn tiền
    // if (order_payment_status === payment_status.REFUNDED) {
    //   throw new BadRequestException(
    //     `Refunded payment order does not support update order status`,
    //   );
    // }

    // Cật nhật trạng thái đơn hàng khi thanh toán thành công đối với chuyển khoản
    switch (current_order_status) {
      case order_status.CONFIRMED:
        order.order_status = order_status.EXPORTED;
        break;
      case order_status.EXPORTED:
        order.order_status = order_status.DELIVERING;
        break;
      case order_status.DELIVERING:
        if (isFailedDelivery) {
          order.order_status = order_status.FAILED_DELIVERY;
          // if (paymentName !== payment_method_name.COD) {
          //   await this.refundForOrder(order, baseManager, 'Failed delivery');
          // }
        } else {
          order.delivery_time = new Date();
          order.order_status = order_status.SHIPPING;
        }
        break;
      case order_status.SHIPPING:
        if (isFailedDelivery) {
          order.order_status = order_status.FAILED_DELIVERY;
          // if (paymentName !== payment_method_name.COD) {
          //   await this.refundForOrder(order, baseManager, 'Failed shipping');
          // }
        } else {
          order.order_status = order_status.DELIVERED;
          if (
            paymentName === payment_method_name.COD &&
            order_payment_status !== payment_status.PAID
          ) {
            order.payment_status = payment_status.PAID;
            order.payment_time = new Date();
          }
        }
        break;
    }
    if (baseManager) {
      await baseManager.save(Order, order);
      const saveOrder = await baseManager.findOne(Order, {
        where: {
          id: order.id,
        },
        relations: ['export'],
      });
      if (saveOrder.order_status === order_status.DELIVERED) {
        await this.detail_import_service.updateQuantitySold(
          saveOrder.export.id,
          baseManager,
        );
      }
    }
  }

  async updateNormalOrderStatus(
    user: any,
    id: string,
    order_note?: string,
    isFailedDelivery: boolean = false,
  ): Promise<{
    status: number;
    message: string;
    data: ResponseOrderDto;
  }> {
    try {
      return await this.orderRepository.manager.transaction(async (manager) => {
        const order = (await this.findOne(id, false)).data as Order;
        this.validateOrderStatus(order);
        const paymentName = order.paymentMethod.name;
        await this.updateNormalOrderStatusLogic(
          user,
          order,
          paymentName,
          isFailedDelivery,
          manager,
        );
        if (order_note) order.note = order_note;
        const updatedOrder = await manager.save(Order, order);
        return {
          status: 200,
          message: `Cật nhật trạng thái đơn hàng ${order_status_label[updatedOrder.order_status]?.toLowerCase()} thành công`,
          data: transformDto(ResponseOrderDto, updatedOrder),
        };
      });
    } catch (e) {
      throw e;
    }
  }

  async cancelOrder(
    orderId: string,
    user: UserValidationType,
    reason?: string,
    baseManager?: EntityManager,
  ): Promise<{
    status: number;
    message: string;
    data: ResponseOrderDto;
  }> {
    try {
      if (!user || !user.id) {
        throw new UnauthorizedException('Bạn chưa đăng nhập');
      }

      if (
        user.role !== RoleEnum.ADMIN &&
        user.role !== RoleEnum.STAFF &&
        user.role !== RoleEnum.USER
      ) {
        throw new UnauthorizedException(
          'Bạn không có quyền thực hiện hành động này',
        );
      }
      const managerRepo = baseManager || this.orderRepository.manager;
      const order = await managerRepo.findOne(Order, {
        where: {
          id: orderId,
        },
        relations: [
          'customer',
          'receiveAddress',
          'paymentMethod',
          'deliveryMethod',
          'orderDetails',
          'orderDetails.skus',
          'orderDetails.skus.product',
        ],
      });

      if (!baseManager) {
        return await managerRepo.transaction(async (manager) => {
          return await this.executeCancelOrder(order, user, manager, reason);
        });
      } else {
        return await this.executeCancelOrder(order, user, managerRepo, reason);
      }
    } catch (e) {
      throw e;
    }
  }

  async executeCancelOrder(
    order: Order,
    user: UserValidationType,
    manager: EntityManager,
    reason?: string,
  ) {
    this.validateOrderStatus(order);
    this.handleCancelOrder(order);
    order.order_status = order_status.CANCELLED;
    if (reason) {
      order.note = reason;
    }
    const updatedOrder = await manager.save(order);
    return {
      status: 200,
      message: 'Order has been successfully CANCELLED ',
      data: transformDto(ResponseOrderDto, updatedOrder),
    };
  }

  // private async refundForOrder(
  //   order: Order,
  //   manager: EntityManager,
  //   reason?: string,
  // ) {
  //   if (!order.paymentMethod) {
  //     throw new BadRequestException(
  //       `Order ${order.id} does not have payment method`,
  //     );
  //   }
  //   if (order.payment_status !== payment_status.PAID) {
  //     return;
  //   }
  //   if (order.paymentMethod.name === payment_method_name.ZALOPAY) {
  //     try {
  //       const refund_result = await this.zaloPaymentService
  //         .refundOrder(order.id, reason || 'Delivering failed', manager)
  //         .then((res) => res.data.response.return_code);
  //       if (refund_result === 1) {
  //         order.payment_status = payment_status.REFUNDED;
  //       } else if (refund_result === 3) {
  //         for (let i = 0; i < 3; i++) {
  //           try {
  //             const refund_result = await this.zaloPaymentService
  //               .checkRefundOrderStatus(order.id)
  //               .then((res) => res.detail.return_code);
  //             if (refund_result === 1) {
  //               order.payment_status = payment_status.REFUNDED;
  //               break;
  //             } else if (refund_result === 3) {
  //               await new Promise((resolve) => setTimeout(resolve, 1000));
  //             } else {
  //               throw new BadRequestException(
  //                 `Check refund failed with return code ${refund_result}`,
  //               );
  //             }
  //           } catch (e) {
  //             console.error(e);
  //             await new Promise((resolve) => setTimeout(resolve, 1000));
  //           }
  //         }
  //       } else {
  //         throw new BadRequestException(
  //           `Refund failed with return code ${refund_result}`,
  //         );
  //       }
  //     } catch (e) {
  //       throw e;
  //     }
  //   } else if (order.paymentMethod.name !== payment_method_name.COD) {
  //     throw new BadRequestException(
  //       `Phương thức thanh toán ${order.paymentMethod.name} chưa hỗ trợ hoàn tiền`,
  //     );
  //   } else {
  //     // Với COD thì thanh toán thủ công
  //     order.payment_status = payment_status.REFUNDED;
  //   }
  // }

  // async confirmOrder(createExport: CreateExportOrderDto, user: any) {
  //   try {
  //     return await this.orderRepository.manager.transaction(async (manager) => {
  //       const order = await manager.findOne(Order, {
  //         where: {
  //           id: createExport.order_id,
  //         },
  //         relations: ['paymentMethod'],
  //       });
  //       this.validateOrderStatus(order);
  //       const paymentName = order.paymentMethod.name;
  //       const paymentStatus = order.payment_status;

  //       if (paymentName !== payment_method_name.COD) {
  //         if (order.order_status !== order_status.PENDING) {
  //           throw new BadRequestException(
  //             `Đơn hàng ${order.id} ${order_status_label[order.order_status]?.toLowerCase()}, không thể xác nhận`,
  //           );
  //         }
  //         if (paymentStatus !== payment_status.PAID) {
  //           throw new BadRequestException(
  //             `Phải thanh toán trước khi xác nhận đơn hàng với phương thức ${paymentName.toLowerCase()}`,
  //           );
  //         }
  //       }

  //       await this.exportService.createExportOrder(createExport, user, manager);
  //       order.order_status = order_status.CONFIRMED;

  //       const saveOrder = await manager.save(order);
  //       return {
  //         status: 200,
  //         message: `Hóa đơn được xác nhận thành công`,
  //         data: transformDto(ResponseOrderDto, saveOrder),
  //       };
  //     });
  //   } catch (e) {
  //     throw e;
  //   }
  // }

  async confirmOrder(user: UserValidationType, id: string) {
    try {
      return await this.orderRepository.manager.transaction(async (manager) => {
        if (!user || !user.id) {
          throw new UnauthorizedException('User chưa được xác thực');
        }
        if (user.role !== RoleEnum.ADMIN && user.role !== RoleEnum.STAFF) {
          throw new ForbiddenException('Bạn không có quyền xác nhận đơn hàng');
        }
        const order = await manager.findOne(Order, {
          where: {
            id,
          },
          relations: ['paymentMethod'],
        });
        this.validateOrderStatus(order);
        const paymentName = order.paymentMethod.name;
        const paymentStatus = order.payment_status;

        // if (paymentName !== payment_method_name.COD) {
        //   if (order.order_status !== order_status.PENDING) {
        //     throw new BadRequestException(
        //       `Đơn hàng ${order.id} ${order_status_label[order.order_status]?.toLowerCase()}, không thể xác nhận`,
        //     );
        //   }
        //   if (paymentStatus !== payment_status.PAID) {
        //     throw new BadRequestException(
        //       `Đơn hàng chưa thanh toán, không thể xác nhận`,
        //     );
        //   }
        // }

        order.order_status = order_status.CONFIRMED;
        const saveOrder = await manager.save(order);
        return {
          status: 200,
          message: `Đơn hàng được xác nhận thành công`,
          data: transformDto(ResponseOrderDto, saveOrder),
        };
      });
    } catch (e) {
      throw e;
    }
  }

  async exportOrder(user: UserValidationType, id: string) {
    try {
      return await this.orderRepository.manager.transaction(async (manager) => {
        if (!user || !user.id) {
          throw new UnauthorizedException('User chưa được xác thực');
        }
        if (
          user.role !== RoleEnum.ADMIN &&
          user.role !== RoleEnum.WAREHOUSE_MANAGER
        ) {
          throw new ForbiddenException('Bạn không có quyền xuất kho đơn hàng');
        }
        const order = await manager.findOne(Order, {
          where: {
            id,
          },
        });
        this.validateOrderStatus(order);
        if (order.order_status !== order_status.CONFIRMED) {
          throw new BadRequestException(
            `Đơn hàng ${order.id} chưa xác nhận, không thể xuất kho`,
          );
        }
        order.order_status = order_status.EXPORTED;
        const saveOrder = await manager.save(order);
        return {
          status: 200,
          message: `Đơn hàng chuyển sang trạng thái xuất kho thành công`,
          data: transformDto(ResponseOrderDto, saveOrder),
        };
      });
    } catch (e) {
      throw e;
    }
  }

  async handOverOrder(user: UserValidationType, id: string) {
    try {
      return await this.orderRepository.manager.transaction(async (manager) => {
        if (!user || !user.id) {
          throw new UnauthorizedException('User chưa được xác thực');
        }
        if (
          user.role !== RoleEnum.ADMIN &&
          user.role !== RoleEnum.WAREHOUSE_MANAGER
        ) {
          throw new ForbiddenException('Bạn không có quyền bàn giao đơn hàng');
        }
        const order = await manager.findOne(Order, {
          where: {
            id,
          },
        });
        this.validateOrderStatus(order);
        if (order.order_status !== order_status.EXPORTED) {
          throw new BadRequestException(
            `Đơn hàng ${order.id} chưa xuất kho, không thể bàn giao`,
          );
        }
        order.order_status = order_status.HAND_OVERED;
        const saveOrder = await manager.save(order);
        return {
          status: 200,
          message: `Đơn hàng đã chuyển sang trạng thái bàn giao thành công`,
          data: transformDto(ResponseOrderDto, saveOrder),
        };
      });
    } catch (e) {
      throw e;
    }
  }

  async deliverOrder(user: UserValidationType, id: string) {
    try {
      return await this.orderRepository.manager.transaction(async (manager) => {
        if (!user || !user.id) {
          throw new UnauthorizedException('User chưa được xác thực');
        }
        if (
          user.role !== RoleEnum.ADMIN &&
          user.role !== RoleEnum.DELIVERY_STAFF
        ) {
          throw new ForbiddenException(
            'Bạn không có quyền vận chuyển đơn hàng',
          );
        }
        const order = await manager.findOne(Order, {
          where: {
            id,
          },
        });
        this.validateOrderStatus(order);
        if (order.order_status !== order_status.HAND_OVERED) {
          throw new BadRequestException(
            `Đơn hàng ${order.id} chưa bàn giao, không thể vận chuyển`,
          );
        }
        order.order_status = order_status.DELIVERING;
        const saveOrder = await manager.save(order);
        return {
          status: 200,
          message: `Đơn hàng đã chuyển sang trạng thái vận chuyển thành công`,
          data: transformDto(ResponseOrderDto, saveOrder),
        };
      });
    } catch (e) {
      throw e;
    }
  }

  async shipOrder(user: UserValidationType, id: string) {
    try {
      return await this.orderRepository.manager.transaction(async (manager) => {
        if (!user || !user.id) {
          throw new UnauthorizedException('User chưa được xác thực');
        }
        if (
          user.role !== RoleEnum.ADMIN &&
          user.role !== RoleEnum.DELIVERY_STAFF
        ) {
          throw new ForbiddenException('Bạn không có quyền giao hàng');
        }
        const order = await manager.findOne(Order, {
          where: {
            id,
          },
        });
        this.validateOrderStatus(order);
        if (order.order_status !== order_status.DELIVERING) {
          throw new BadRequestException(
            `Đơn hàng ${order.id} chưa vận chuyển, không thể giao hàng`,
          );
        }
        order.order_status = order_status.SHIPPING;
        const saveOrder = await manager.save(order);
        return {
          status: 200,
          message: `Đơn hàng đã chuyển sang trạng thái giao hàng thành công`,
          data: transformDto(ResponseOrderDto, saveOrder),
        };
      });
    } catch (e) {
      throw e;
    }
  }

  async shipOrderSuccess(user: UserValidationType, id: string) {
    try {
      return await this.orderRepository.manager.transaction(async (manager) => {
        if (!user || !user.id) {
          throw new UnauthorizedException('User chưa được xác thực');
        }
        if (
          user.role !== RoleEnum.ADMIN &&
          user.role !== RoleEnum.DELIVERY_STAFF
        ) {
          throw new ForbiddenException('Bạn không có quyền giao hàng');
        }
        const order = await manager.findOne(Order, {
          where: {
            id,
          },
          relations: ['paymentMethod'],
        });
        const paymentName = order.paymentMethod.name;
        const order_payment_status = order.payment_status;
        this.validateOrderStatus(order);
        if (order.order_status !== order_status.SHIPPING) {
          throw new BadRequestException(
            `Đơn hàng ${order.id} chưa giao hàng, không thể cập nhật trạng thái giao hàng thành công`,
          );
        }
        if (
          paymentName === payment_method_name.COD &&
          order_payment_status !== payment_status.PAID
        ) {
          order.payment_status = payment_status.PAID;
          order.payment_time = new Date();
        }
        order.order_status = order_status.DELIVERED;
        order.delivery_time = new Date();
        const saveOrder = await manager.save(order);
        return {
          status: 200,
          message: `Đơn hàng đã giao thành công`,
          data: transformDto(ResponseOrderDto, saveOrder),
        };
      });
    } catch (e) {
      throw e;
    }
  }

  async failedDeliveryOrder(
    user: UserValidationType,
    id: string,
    reason?: string,
  ) {
    try {
      return await this.orderRepository.manager.transaction(async (manager) => {
        if (!user || !user.id) {
          throw new UnauthorizedException('User chưa được xác thực');
        }
        if (
          user.role !== RoleEnum.ADMIN &&
          user.role !== RoleEnum.DELIVERY_STAFF
        ) {
          throw new ForbiddenException('Bạn không có quyền giao hàng');
        }
        const order = await manager.findOne(Order, {
          where: {
            id,
          },
        });
        this.validateOrderStatus(order);

        if (
          order.order_status !== order_status.DELIVERING &&
          order.order_status !== order_status.SHIPPING
        ) {
          throw new BadRequestException(
            `Đơn hàng chưa vận chuyển hoặc giao hàng, không thể cập nhật trạng thái giao hàng thất bại`,
          );
        }
        order.order_status = order_status.FAILED_DELIVERY;
        if (reason) {
          order.note = reason;
        }
        const saveOrder = await manager.save(order);
        return {
          status: 200,
          message: `Đơn hàng đã chuyển sang trạng thái giao hàng thất bại`,
          data: transformDto(ResponseOrderDto, saveOrder),
        };
      });
    } catch (e) {
      throw e;
    }
  }

  async getMonthlyStatistics(months: { year: number; month: number }[]) {
    try {
      // Xác định khoảng thời gian
      const startDate = dayjs(`${months[0].year}-${months[0].month}-01`)
        .startOf('month')
        .toDate();
      const endDate = dayjs(
        `${months[months.length - 1].year}-${months[months.length - 1].month}-01`,
      )
        .endOf('month')
        .toDate();

      // Truy vấn duy nhất cho tất cả các tháng
      const result = await this.orderRepository
        .createQueryBuilder('order')
        .leftJoin('order.orderDetails', 'orderDetail')
        .leftJoin('orderDetail.skus', 'skus')
        .select('EXTRACT(YEAR FROM order.createdAt)', 'year')
        .addSelect('EXTRACT(MONTH FROM order.createdAt)', 'month')
        .addSelect('SUM(order.total_price)', 'revenue')
        .addSelect(
          `SUM(order.total_price - orderDetail.quantity * COALESCE((
            SELECT di.price_import
            FROM detail_import di
            WHERE di.skus_id = skus.id
            ORDER BY di.created_at DESC
            LIMIT 1
          ), 0))`,
          'profit',
        )
        .where('order.createdAt BETWEEN :start AND :end')
        .andWhere('order.order_status = :status', {
          status: order_status.DELIVERED,
        })
        .andWhere('order.payment_status = :paymentStatus', {
          paymentStatus: payment_status.PAID,
        })
        .setParameters({ start: startDate, end: endDate })
        .groupBy(
          'EXTRACT(YEAR FROM order.createdAt), EXTRACT(MONTH FROM order.createdAt)',
        )
        .orderBy('year', 'ASC')
        .addOrderBy('month', 'ASC')
        .getRawMany();

      // Tạo danh sách đầy đủ các tháng trong khoảng
      const stats: {
        year: number;
        month: number;
        revenue: number;
        profit: number;
      }[] = [];
      const resultMap = new Map(
        result.map((item) => [
          `${item.year}-${item.month.toString().padStart(2, '0')}`,
          item,
        ]),
      );

      for (const { year, month } of months) {
        const monthKey = `${year}-${month.toString().padStart(2, '0')}`;
        const record = resultMap.get(monthKey);
        stats.push({
          year,
          month,
          revenue: record ? parseFloat(record.revenue) || 0 : 0,
          profit: record ? parseFloat(record.profit) || 0 : 0,
        });
      }

      return {
        message: 'Lấy thống kê doanh thu và lợi nhuận hàng tháng thành công',
        status: 200,
        data: {
          monthly_revenue: stats.map((s) => s.revenue),
          monthly_profit: stats.map((s) => s.profit),
          revenue_daily: [],
          profit_daily: [],
        },
      };
    } catch (e) {
      throw e;
    }
  }
  async getDailyStatistics(startDate: Date, endDate: Date) {
    const result = await this.orderRepository
      .createQueryBuilder('order')
      .leftJoin('order.orderDetails', 'orderDetail')
      .leftJoin('orderDetail.skus', 'skus')
      .select('DATE(order.createdAt)', 'date')
      .addSelect('SUM(order.total_price)', 'revenue')
      .addSelect(
        `SUM(order.total_price - orderDetail.quantity * COALESCE((
        SELECT di.price_import
        FROM detail_import di
        WHERE di.skus_id = skus.id
        ORDER BY di.created_at DESC
        LIMIT 1),0))`,
        'profit',
      )
      .where('order.createdAt BETWEEN :start AND :end')
      .andWhere('order.order_status = :status', {
        status: order_status.DELIVERED,
      })
      .andWhere('order.payment_status = :paymentStatus', {
        paymentStatus: payment_status.PAID,
      })
      .setParameters({ start: startDate, end: endDate })
      .groupBy('DATE(order.createdAt)')
      .orderBy('date', 'ASC')
      .getRawMany();

    // Tạo danh sách đầy đủ các ngày trong khoảng
    const days: { date: string; revenue: number; profit: number }[] = [];
    let current = dayjs(startDate);
    const resultMap = new Map(
      result.map((item) => [dayjs(item.date).format('YYYY-MM-DD'), item]),
    );

    while (current.isBefore(endDate) || current.isSame(endDate, 'day')) {
      const dateStr = current.format('YYYY-MM-DD');
      const record = resultMap.get(dateStr);
      days.push({
        date: dateStr,
        revenue: record ? parseFloat(record.revenue) || 0 : 0,
        profit: record ? parseFloat(record.profit) || 0 : 0,
      });
      current = current.add(1, 'day');
    }

    return {
      message: 'Lấy thống kê doanh thu và lợi nhuận hàng ngày thành công',
      status: 200,
      data: {
        monthly_revenue: [],
        monthly_profit: [],
        revenue_daily: days.map((d) => d.revenue),
        profit_daily: days.map((d) => d.profit),
      },
    };
  }

  async getTotalRevenueByYear(year: number) {
    try {
      const result = await this.orderRepository
        .createQueryBuilder('order')
        .select('SUM(order.total_price)', 'total_revenue')
        .where('EXTRACT(YEAR FROM order.createdAt) = :year', { year })
        .andWhere('order.order_status = :status', {
          status: order_status.DELIVERED,
        })
        .andWhere('order.payment_status = :paymentStatus', {
          paymentStatus: payment_status.PAID,
        })
        .getRawOne();

      return {
        status: 200,
        message: `Doanh thu tổng cộng trong năm ${year} đã được lấy thành công`,
        data: result ? parseFloat(result.total_revenue) || 0 : 0,
      };
    } catch (e) {
      throw e;
    }
  }

  async getOrderStatusByYear(year: number) {
    try {
      const result = await this.orderRepository
        .createQueryBuilder('order')
        .select('order.order_status', 'status')
        .addSelect('COUNT(order.id)', 'count')
        .where('EXTRACT(YEAR FROM order.createdAt) = :year', { year })
        .groupBy('order.order_status')
        .getRawMany();
      const orderStatusMap = new Map(
        result.map((item) => [item.status, item.count]),
      );
      const orderStatus = Object.keys(order_status)
        .filter((key) => isNaN(Number(key)))
        .reduce((acc, key) => {
          const orderValue = order_status[key]?.toString();
          const statusCount = orderStatusMap.get(orderValue);
          acc[key] = statusCount ? parseInt(statusCount, 10) : 0;
          return acc;
        }, {});

      return {
        status: 200,
        message: `Trạng thái đơn hàng trong năm ${year} đã được lấy thành công`,
        data: orderStatus,
      };
    } catch (e) {
      throw e;
    }
  }

  async checkZaloPayOrderStatus(order_id: string) {
    const order = await this.orderRepository.findOne({
      where: { id: order_id },
      relations: ['OrderPaymentMethodOptions', 'paymentMethod'],
    });
    const app_trans_id = order.OrderPaymentMethodOptions.find(
      (o) => o.paymentMethodOption.name === ZaloPaySaveDatabaseKey.app_trans_id,
    )?.value;
    if (!app_trans_id)
      throw new NotFoundException(
        `Không tìm thấy mã giao dịch ZaloPay ${ZaloPaySaveDatabaseKey.app_trans_id} trong đơn hàng ${order_id}`,
      );
    const postData: ZaloOrderStatus = {
      app_id: ZaloPayConfig.app_id,
      app_trans_id: app_trans_id,
      mac: '',
    };
    // Tạo MAC từ app_id, app_trans_id và key1
    const data = `${postData.app_id}|${postData.app_trans_id}|${ZaloPayConfig.key1}`;
    postData.mac = generateMac(data, ZaloPayConfig.key1);
    const postConfig = {
      method: 'post',
      url: ZaloPay_query_url,
      headers: {
        'Content-Type': API_Header_Content_Type_Format.FORM,
      },
      data: JSON.stringify(postData),
    };
    try {
      const result = await axios(postConfig);
      const resData = result.data;
      let transaction_status = 'N/A';
      let status_code = 500;
      const zp_trans_id = resData.zp_trans_id;
      const paymentMethod = await this.paymentMethodOptionRepository.findOne({
        where: {
          name: payment_method_name.ZALOPAY,
        },
      });
      const existing_Zp_Trans_Id = order.OrderPaymentMethodOptions.find(
        (o) =>
          o.paymentMethodOption.name === ZaloPaySaveDatabaseKey.zp_trans_id,
      );
      if (!paymentMethod)
        throw new NotFoundException(
          `Không tìm thấy mã ${ZaloPaySaveDatabaseKey.zp_trans_id} trong phiên giao dịch`,
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

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkPendingPaymentOrder() {
    try {
      const orders = await this.orderRepository.find({
        where: {
          payment_status: payment_status.PENDING,
          payment_url_expired: Raw((p) => `${p} IS NOT NULL AND ${p} >= NOW()`),
        },
        relations: ['paymentMethod', 'paymentTransactions'],
      });
      for (const order of orders) {
        try {
          const order_id = order.id;
          if (order.paymentMethod.name === payment_method_name.ZALOPAY) {
            await this.checkZaloPayOrderStatus(order_id);
          } else if (order.paymentMethod.name === payment_method_name.PAYOS) {
            const order_payment_id =
              order.paymentTransactions[0].payment_order_id;
            const user: UserValidationType = {
              id: 'system',
              username: 'system',
              role: RoleEnum.ADMIN,
              email: '',
              phone: '',
              permissions: [],
            };
            await this.payosService.CheckPayosPaymentStatus(
              user,
              order_payment_id,
            );
          }
        } catch (e) {}
      }
    } catch (e) {
      throw e;
    }
  }
}
