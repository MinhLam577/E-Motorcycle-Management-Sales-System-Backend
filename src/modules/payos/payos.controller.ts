import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import { PayosService } from './payos.service';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CreatePayOsOrderDto } from './dto/create-order-payos.dto';
import { User } from 'src/decorators/current-user';
import { Tag } from 'src/constants/api-tag.enum';
import { UserValidationType } from 'src/auth/strategy/jwt.strategy';
import CancelOrderPayosDto from './dto/cancel-order-payos.dto';
import ConfirmWebhookPayOsDto from './dto/confirm-webhook-payos.dto';
import { Public } from 'src/decorators/public-route';

@Controller('payos')
@ApiTags(Tag.PAYOS)
@ApiBearerAuth()
export class PayosController {
  constructor(private readonly payosService: PayosService) {}

  @Post('create-order')
  @ApiOperation({
    summary: 'Tạo hóa đơn thanh toán từ payos',
  })
  @ApiBody({
    type: CreatePayOsOrderDto,
    required: true,
    description: 'Thông tin đơn hàng cần thanh toán',
  })
  async createOrder(
    @User() user: UserValidationType,
    @Body() createPayOsOrder: CreatePayOsOrderDto,
  ) {
    return await this.payosService.createOrderPayment(user, createPayOsOrder);
  }

  @Post('cancel-order/:id')
  @ApiOperation({
    summary: 'Huỷ đơn hàng đã tạo',
  })
  @ApiBody({
    type: CancelOrderPayosDto,
    required: false,
    description: 'Thông tin huỷ đơn hàng',
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'ID đơn hàng cần huỷ',
  })
  async cancelOrder(
    @User() user: UserValidationType,
    @Param('id') id: string,
    @Body() body: CancelOrderPayosDto,
  ) {
    return await this.payosService.cancelOrderPayment(user, id, body);
  }

  @Post('confirm-webhook')
  @ApiOperation({
    summary: 'Xác nhận webhook từ PayOs',
  })
  @ApiBody({
    type: ConfirmWebhookPayOsDto,
    required: true,
    description: 'Thông tin xác nhận webhook từ PayOs',
  })
  async confirmWebhook(@Body() body: ConfirmWebhookPayOsDto): Promise<any> {
    return await this.payosService.confirmWebhook(body);
  }

  @Post('webhook-url')
  @Public()
  @ApiOperation({
    summary: 'Nhận dữ liệu thanh toán từ PayOs',
  })
  async handleWebhook(@Req() req: any) {
    return await this.payosService.handleWebhook(req);
  }

  @Post('check-payos-payment-status/:id')
  @ApiOperation({
    summary: 'Lấy thông tin thanh toán của đơn hàng',
  })
  async CheckPayosPaymentStatus(
    @User() user: UserValidationType,
    @Param('id', ParseIntPipe) orderId: number,
  ) {
    return await this.payosService.CheckPayosPaymentStatus(user, orderId);
  }
}
