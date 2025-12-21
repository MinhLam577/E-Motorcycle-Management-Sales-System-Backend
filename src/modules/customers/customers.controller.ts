import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
  UploadedFile,
  Req,
  Query,
} from '@nestjs/common';
import { Request } from 'express';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import {
  ChangePassword_Profile,
  UpdateCustomerDto,
} from './dto/update-customer.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Tag } from 'src/constants/api-tag.enum';
import { FileInterceptor } from '@nestjs/platform-express';
import { FileValidationPipe } from 'src/pipe/file-validation.pipe';
import { Public } from 'src/decorators/public-route';
import { ResponseMessage } from 'src/decorators/response_message.decorator';
import QueryCustomerDto from './dto/query-customer.dto';
import { User } from 'src/decorators/current-user';

@ApiTags(Tag.CUSTOMERS)
@Controller('customers')
@ApiBearerAuth()
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  // tạo customer trang quản lí
  @ApiOperation({ summary: 'Tạo mới khách hàng trang admin ' })
  @Post()
  @ApiBody({ type: CreateCustomerDto })
  @ResponseMessage('Tạo mới khách hàng thành công')
  async createCustomer(@Body() CreateCustomerDto: CreateCustomerDto) {
    return this.customersService.createCustomerByPageAdmin(CreateCustomerDto);
  }
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Đổi mật khẩu khách hàng' })
  @ApiBody({ type: ChangePassword_Profile })
  @Post('/changePassword')
  @ResponseMessage('Đổi mật khẩu thành công')
  async changePassword_InProfile(
    @User() user,
    @Body() ChangePassword_Profile: ChangePassword_Profile,
  ) {
    return this.customersService.changePassword_InProfile(
      user,
      ChangePassword_Profile,
    );
  }

  @ApiBearerAuth()
  @ApiOperation({
    description: 'Lấy tài khoản khi đăng nhập social media',
  })
  @ResponseMessage('Lấy tài khoản user thành công')
  @Get('profile')
  async getProfile(@User() user) {
    return this.customersService.getProfile(user);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'upload user avatar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'The file has been successfully uploaded',
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          example: 'https://res.cloudinary.com/user/avatar.png',
        },
        public_id: { type: 'string', example: 'avatar_12345' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Cloudinary-specific error',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error - Cloudinary failure',
  })
  @Post('upload')
  @ResponseMessage('Cập nhật avatar thành công')
  @UseInterceptors(FileInterceptor('file'))
  uploadAvatar(
    @UploadedFile(new FileValidationPipe()) file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.customersService.uploadAvatar(file, req.user);
  }

  @ApiOperation({ summary: 'update user information' })
  @ApiOkResponse({ description: 'Successful operation' })
  @ApiResponse({ status: 201, description: 'Successful operation 1 ' })
  @ApiInternalServerErrorResponse({ description: 'Server error' })
  @Patch(':id')
  @ResponseMessage('Cập nhật khách hàng thành công')
  @ApiParam({
    name: 'id',
    example: '8284b91b-7ddc-43c2-ab5f-090a1e1fbd2e',
  })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateCustomerDto) {
    return this.customersService.update(id, updateUserDto);
  }

  @ApiOperation({ summary: ' Xóa user information -> mất review + images' })
  @ApiOkResponse({ description: 'Successful operation' })
  @ApiResponse({ status: 201, description: 'Successful operation 1 ' })
  @ApiInternalServerErrorResponse({ description: 'Server error' })
  @Delete(':id')
  @ResponseMessage('Xóa user thành công')
  @ApiParam({
    name: 'id',
    example: 'cff60da5-700b-4bed-96d5-57738488a7d7',
  })
  delete(@Param('id') id: string) {
    return this.customersService.remove(id);
  }

  @ApiOperation({ summary: 'Lấy tất cả khách hàng' })
  @Get()
  @ResponseMessage('Lấy tất cả khách hàng thành công')
  async findAllCustomer(@Query() query: QueryCustomerDto) {
    return this.customersService.getAll(query);
  }
  @ApiParam({
    name: 'id',
    example: 'cff60da5-700b-4bed-96d5-57738488a7d7',
  })
  @Get(':id')
  @ResponseMessage('Lấy khách hàng theo id thành công')
  async getUserbyId(@Param('id') id: string) {
    return this.customersService.getFindById(id);
  }
}
