import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Request,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  ActiveAccount,
  ChangeAcount,
  LoginDto,
  UserInfo,
} from './dto/create-auth.dto';
import { RefreshAuthGuard } from './gaurds/refresh-auth.guard';
import { Public } from 'src/decorators/public-route';
import { GoogleAuthGuard } from './gaurds/google-oauth.guard';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Tag } from 'src/constants/api-tag.enum';
import { Response } from 'express';
import { ResponseMessage } from 'src/decorators/response_message.decorator';
import EmailDto from './dto/email-format.dto';
import { ConfigService } from '@nestjs/config';
import appConfig from 'src/config/app.config';
import ResetPassword from './dto/reset-password.dto';
import VerifyResetPasswordDto from './dto/verify-reset-password.dto';
import { ProfileFacebook } from 'src/types/facebook-oaut.type';
import { FacebookAuthGuard } from './gaurds/facebook-oauth.guard';
import { JwtAuthGuard } from './gaurds/jwt-auth.guard';
import { User } from 'src/decorators/current-user';
import { JwtService } from '@nestjs/jwt';
import { UserService } from 'src/modules/user/user.service';
import { CustomersService } from 'src/modules/customers/customers.service';
import { BaseUser, UserResponse } from 'src/types/auth-validate.type';
import { RoleEnum } from 'src/constants/role.enum';
import { Permission } from 'src/modules/permission/entities/permission.entity';
import BasicResetPassword from './dto/basic-reset-password';

@Public()
@ApiTags(Tag.AUTHENTICATE)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly customerService: CustomersService,
  ) {}

  @ApiOperation({
    summary: 'get access token and refresh token after validate',
  })
  @ApiResponse({
    status: 200,
    description: 'Success get access and refresh token',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid user',
  })
  @ResponseMessage('Đăng nhập thành công')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  handleLogin(@Body() userInfo: LoginDto) {
    return this.authService.login(userInfo);
  }

  @ApiOperation({
    summary:
      'Login 4 role: admin, staff,manager,sales and get access token and refresh token after validate',
  })
  @ApiResponse({
    status: 200,
    description: 'Success get access and refresh token',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid user',
  })
  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  handleLoginAdmin(@Body() userInfo: LoginDto) {
    return this.authService.loginAdmin(userInfo);
  }

  @ApiOperation({
    summary: 'Refresh access token cho customer',
    description: `
      Gửi lên header Authorization với refresh token để lấy access token mới.
      Ví dụ:
      - Header: Authorization: Bearer <refresh_token>
    `,
  })
  @ApiBearerAuth()
  @ApiResponse({
    status: 201,
    description: 'Access token mới được tạo thành công',
    schema: {
      example: {
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    },
  })
  @UseGuards(RefreshAuthGuard)
  @Get('refresh')
  handleRefreshToken(@Req() req) {
    return this.authService.refreshAccessToken(req.user, { isAdmin: false });
  }

  @ApiOperation({
    summary: 'Refresh access token cho admin',
    description: `
      Gửi lên header Authorization với refresh token để lấy access token mới.
      Ví dụ:
      - Header: Authorization: Bearer <refresh_token>
    `,
  })
  @ApiBearerAuth()
  @ApiResponse({
    status: 201,
    description: 'Access token mới được tạo thành công',
    schema: {
      example: {
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    },
  })
  @UseGuards(RefreshAuthGuard)
  @Get('admin/refresh')
  handleRefreshTokenAdmin(@Req() req) {
    return this.authService.refreshAccessToken(req.user, { isAdmin: true });
  }

  @ApiOperation({
    summary:
      'Tạo tài khoản người dùng bình thường (customer) và gửi mã kích hoạt về email',
  })
  @Post('register')
  register(@Body() userInfo: UserInfo) {
    return this.authService.register(userInfo, { isAdmin: false });
  }

  @ApiOperation({
    summary: 'Tạo tài khoản admin và gửi mã kích hoạt về email',
  })
  @Post('admin/register')
  registerAdmin(@Body() userInfo: UserInfo) {
    return this.authService.register(userInfo);
  }

  @ApiOperation({
    summary: 'kích hoạt tài khoản bằng mã code cho customer',
  })
  @Post('check-code')
  checkCode(@Body() dataActive: ActiveAccount) {
    return this.authService.handleActive(dataActive, { isAdmin: false });
  }

  @ApiOperation({
    summary: 'kích hoạt tài khoản bằng mã code cho admin',
  })
  @Post('admin/check-code')
  checkCodeAdmin(@Body() dataActive: ActiveAccount) {
    return this.authService.handleActive(dataActive);
  }

  @ApiOperation({
    summary: 'Kiểm tra mã kích hoạt tài khoản (Admin)',
  })
  @Get('admin/verify-code')
  async checkActivationCodeAdmin(@Query() dto: ActiveAccount) {
    return this.authService.verifyActivationCode(dto, { isAdmin: true });
  }

  @ApiOperation({
    summary: 'Kiểm tra mã kích hoạt tài khoản (User)',
  })
  @Get('verify-code')
  async checkActivationCode(@Query() dto: ActiveAccount) {
    return this.authService.verifyActivationCode(dto, { isAdmin: false });
  }

  @Post('retry-active')
  @ApiOperation({
    summary: 'Gửi lại mã kích hoạt tài khoản vào gmail của khách hàng',
  })
  @ApiBody({
    description: 'Email của người dùng cần gửi lại mã kích hoạt. Trả về Email',
    type: EmailDto,
  })
  retryActive(@Body() body: EmailDto) {
    const { email } = body;
    return this.authService.retryActive(email, { isAdmin: false });
  }

  @Post('admin/retry-active')
  @ApiOperation({
    summary: 'Gửi lại mã kích hoạt tài khoản vào gmail của admin',
  })
  @ApiBody({
    description: 'Email của người dùng cần gửi lại mã kích hoạt. Trả về Email',
    type: EmailDto,
  })
  retryActiveAdmin(@Body() body: EmailDto) {
    const { email } = body;
    return this.authService.retryActive(email);
  }

  @Post('retryPassword')
  @ApiOperation({
    summary: 'gửi lại mã code về mail để thay đổi mật khẩu khi chưa login',
  })
  @ApiBody({
    description:
      'The email address of the user to retry the activation process . Trả về Email',
    type: EmailDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully sent the activation email.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid email or user not found.',
  })
  retryPassword(@Body('email') email: string) {
    return this.authService.retryPassword(email);
  }
  @Post('change-password')
  changePassword(@Body() dataActive: ChangeAcount) {
    return this.authService.changePassword(dataActive);
  }

  @Post('admin/retryPassword')
  @ApiOperation({
    summary: 'gửi lại mã code về mail để thay đổi mật khẩu khi chưa login ',
  })
  @ApiBody({
    description:
      'The email address of the user to retry the activation process . Trả về Email',
    type: EmailDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully sent the activation email.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid email or user not found.',
  })
  retryPasswordAdmin(@Body('email') email: string) {
    return this.authService.retryPasswordAdmin(email);
  }
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({
    summary: 'Url chuyển hướng đến google',
  })
  googleLogin() {}
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({
    summary: 'Google Login Callback',
  })
  async googleCallback(@Req() req, @Res() res: Response) {
    const user = await this.authService.validateGoogleUser(req.user);
    let Fe_Url = `${appConfig().FE_URL_USER}/success?token=${user.access_token}&refresh_token=${user.refresh_token}`;
    return res.redirect(Fe_Url);
  }

  @Get('me')
  async getMe(@Req() req) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('No token');
    }

    const token = authHeader.split(' ')[1];

    try {
      const payload = this.jwtService.verify(token);
      let user = await this.customerService.getCustomerByEmail(payload.email);
      let roleName: RoleEnum = RoleEnum.USER;
      const userResponse: UserResponse = {
        userId: user.id,
        username: user.username,
        email: user.email,
        Roles: roleName,
        avatarUrl: user.avatarUrl,
        age: user.age,
        gender: user.gender,
        isActice: user.isActice,
        birthday: user.birthday,
        phoneNumber: user.phoneNumber,
      };

      return userResponse;
    } catch (e) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  @Get('/facebook')
  @UseGuards(FacebookAuthGuard)
  async facebookLogin() {}

  @Get('/facebook/redirect')
  @UseGuards(FacebookAuthGuard)
  async facebookLoginRedirect(@Req() req, @Res() res: Response) {
    const { error } = req.query;

    if (error) {
      return res.redirect(
        `${process.env.FE_URL_USER}/login?error=facebook_cancel`,
      );
    }
    const userFb = req.user as ProfileFacebook;
    const user = await this.authService.validateFacebookUser(userFb);
    const frontendURL = `${appConfig().FE_URL_USER}/success?token=${user.access_token}`;
    return res.redirect(frontendURL);
  }

  /////// Liên hệ gửi mail về admin và phản hồi khách hàng
  // @Public()
  // @ApiOperation({
  //   summary: 'Liên hệ gửi mail về admin và phản hồi khách hàng ',
  // })
  // @Post('contact')
  // @ResponseMessage('Báo giá thành công. Chúng tôi sẽ liên hệ với bạn sớm nhất')
  // async sendMailAdmin_ResponseCustomer(@Body() info: InfoContact) {
  //   return await this.authService.sendMailAdmin_ResponseCustomer(info);
  // }

  @ApiOperation({
    summary: 'Quên mật khẩu cho tài khoản',
  })
  @Post('admin/forgot-password')
  @ApiBody({
    type: EmailDto,
    required: true,
    description: 'Email đăng nhập của tài khoản',
  })
  async forgotPassword(@Body() body: EmailDto) {
    return await this.authService.forgotPassword({ email: body.email });
  }

  @ApiOperation({
    summary: 'Xác thực reset password cho admin',
  })
  @Post('admin/verify-reset-password')
  @ApiBody({
    type: VerifyResetPasswordDto,
    required: true,
    description: 'Email đăng nhập của tài khoản',
  })
  async verifyResetPasswordToken(@Body() body: VerifyResetPasswordDto) {
    return await this.authService.verifyResetPasswordToken({
      ...body,
    });
  }

  @ApiOperation({
    summary: 'Thay đổi lại mật khẩu',
  })
  @Post('admin/reset-password')
  async resetPassword(@Body() body: ResetPassword) {
    return this.authService.resetPassword({
      token: body.token,
      newPassword: body.newPassword,
    });
  }

  @ApiOperation({
    summary: 'Thay đổi lại mật khẩu',
  })
  @ApiBearerAuth()
  @Patch('admin/reset-password-basic')
  async basicResetPassword(@Body() body: BasicResetPassword) {
    return this.authService.basicResetPassword({
      id: body.id,
      oldPassword: body.oldPassword,
      newPassword: body.newPassword,
    });
  }
}
